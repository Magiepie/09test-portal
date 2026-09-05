"""Run either the classic or mk2 MR deployer against a dedicated local test branch."""

import argparse
from collections import deque
from importlib.util import module_from_spec, spec_from_file_location
import json
from pathlib import Path
import subprocess
import sys
import time


def git_with_retry(args, cwd):
    attempt = 0
    while True:
        attempt += 1
        result = subprocess.run(args, cwd=cwd, capture_output=True, text=True, errors="replace")
        if result.returncode == 0:
            return
        output = f"{result.stdout}\n{result.stderr}".strip()
        print(output)
        print(f"GitLab is unavailable; retrying in 15 seconds (attempt {attempt}).")
        time.sleep(15)


def load_bot(script_path):
    spec = spec_from_file_location("damighty_mk2_mr_bot", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load Damighty's mk2 deployer from {script_path}")
    module = module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--server-root", required=True)
    parser.add_argument("--servertools-root", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--exclusions", required=True)
    parser.add_argument("--mode", choices=("classic", "mk2"), default="classic")
    parser.add_argument("--manual-branches", required=True)
    args = parser.parse_args()

    server_root = Path(args.server_root).resolve()
    exclusions_path = Path(args.exclusions).resolve()
    manifest_path = Path(args.manifest).resolve()
    manual_branches_path = Path(args.manual_branches).resolve()
    try:
        excluded_mrs = {int(mr) for mr in json.loads(exclusions_path.read_text(encoding="utf-8"))}
    except FileNotFoundError:
        excluded_mrs = set()
    except (ValueError, TypeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Invalid MR exclusion file: {exclusions_path}") from exc
    try:
        previous_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        previous_manifest = []
    except json.JSONDecodeError:
        previous_manifest = []
    previous_metadata = {
        int(item["iid"]): {
            "title": item.get("title", ""),
            "labels": item.get("labels", []),
            "author": item.get("author", ""),
        }
        for item in previous_manifest
        if isinstance(item, dict) and str(item.get("iid", "")).isdigit()
    }
    try:
        manual_branches = json.loads(manual_branches_path.read_text(encoding="utf-8"))
        if not isinstance(manual_branches, list):
            raise TypeError("manual branch data must be a list")
    except FileNotFoundError:
        manual_branches = []
    except (TypeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Invalid manually added branch file: {manual_branches_path}") from exc
    bot_script = Path(args.servertools_root).resolve() / "devops scripts" / "deploy_MRs_for_test.py"
    if not (server_root / ".git").exists():
        raise RuntimeError(f"SERVER_ROOT is not a Git checkout: {server_root}")
    if not bot_script.exists():
        raise RuntimeError(f"The {args.mode} deployer was not found: {bot_script}")

    merge_in_progress = subprocess.run(
        ["git", "rev-parse", "-q", "--verify", "MERGE_HEAD"],
        cwd=server_root,
        capture_output=True,
        text=True,
    ).returncode == 0
    if merge_in_progress:
        print("Recovering from an unfinished previous deployment merge...")
        subprocess.run(["git", "merge", "--abort"], cwd=server_root, check=True)

    git_with_retry(["git", "fetch", "origin", "master"], server_root)
    mr_refspec = "+refs/merge-requests/*/head:refs/remotes/origin/merge-requests/*"
    configured_refspecs = subprocess.run(
        ["git", "config", "--get-all", "remote.origin.fetch"],
        cwd=server_root,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.splitlines()
    if mr_refspec not in configured_refspecs:
        subprocess.run(
            ["git", "config", "--add", "remote.origin.fetch", mr_refspec],
            cwd=server_root,
            check=True,
        )
    subprocess.run(
        ["git", "switch", "--force-create", "local-current-test", "origin/master"],
        cwd=server_root,
        check=True,
    )

    bot = load_bot(bot_script)
    # This private portal reads the public queue but never edits upstream GitLab.
    bot.POST_MESSAGE = False
    bot.UPDATE_LABELS = False
    bot.TOGGLE_DRAFT = False
    bot.MARK_BAD_MRS = False
    bot.CHECK_ABANDONED = False

    original_get = bot.requests.get

    def resilient_get(*request_args, **request_kwargs):
        attempt = 0
        while True:
            attempt += 1
            try:
                response = original_get(*request_args, **request_kwargs)
                if response.status_code != 429 and response.status_code < 500:
                    return response
                detail = f"HTTP {response.status_code}"
            except bot.requests.RequestException as exc:
                detail = str(exc)
            print(f"GitLab API is unavailable ({detail}); retrying in 15 seconds (attempt {attempt}).")
            time.sleep(15)

    def resilient_git_fetch():
        print("Fetching master and all GitLab MR refs...")
        git_with_retry(["git", "fetch", "origin", "--prune"], server_root)

    bot.requests.get = resilient_get
    bot.git_fetch = resilient_git_fetch
    if args.mode == "mk2":
        original_check_blocked_mrs = bot.check_blocked_mrs
        original_analyze_mr_overlaps = bot.analyze_mr_overlaps

        def progress_check_blocked_mrs(mr_list):
            total = len(mr_list)
            print(f"Next: checking GitLab dependency/blocker relationships for {total} MRs...")
            print("This performs one GitLab API check per MR and may take a little while.")
            result = original_check_blocked_mrs(mr_list)
            print(f"Dependency scan complete ({len(result)} MRs have open blockers).")
            return result

        def progress_analyze_mr_overlaps(mr_ids):
            print(f"Next: reading changed-file metadata and checking overlaps for {len(mr_ids)} MRs...")
            result = original_analyze_mr_overlaps(mr_ids)
            print("Changed-file and overlap analysis complete. Next: fetching MR refs and rebuilding the branch.")
            return result

        def streaming_verify_compilation(cache=None, run_command=None):
            tree_sha = None
            if cache is not None:
                tree_sha = bot.get_current_tree()
                cached = cache.get(tree_sha)
                if cached is not None:
                    bot.LOGGER.info("Reusing cached compilation result for tree %s", tree_sha[:12])
                    return cached.compiles, cached.output
            bot.LOGGER.info("Running Maven compilation check (live output follows)...")
            process = subprocess.Popen(
                bot._maven_wrapper_command(), cwd=bot._compile_working_directory(),
                shell=bot._is_windows(), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, errors="replace", bufsize=1,
            )
            output_tail = deque(maxlen=250)
            if process.stdout is not None:
                for line in process.stdout:
                    clean_line = line.rstrip("\r\n")
                    output_tail.append(clean_line)
                    print(f"[maven] {clean_line}", flush=True)
            compiles = process.wait() == 0
            output = "" if compiles else "\n".join(output_tail).strip() or "Compilation failed."
            if cache is not None:
                cache.remember(tree_sha, bot.BuildResult(compiles, output))
            return compiles, output

        bot.check_blocked_mrs = progress_check_blocked_mrs
        bot.analyze_mr_overlaps = progress_analyze_mr_overlaps
        bot.verify_compilation = streaming_verify_compilation
    deployed_mrs = []
    mr_metadata = {}
    original_fetch_mr_data = bot.fetch_mr_data
    original_merge_mrs = bot.merge_mrs

    def tracked_fetch_mr_data():
        data = original_fetch_mr_data()
        for mr in data:
            author = mr.get("author") or {}
            mr_metadata[int(mr["iid"])] = {
                "title": mr.get("title", ""),
                "labels": [label for label in mr.get("labels", []) if isinstance(label, str)],
                "author": author.get("name") or author.get("username") or "",
            }
        return data

    def tracked_merge_mrs(mrs_to_deploy, tested, *merge_args, **merge_kwargs):
        selected = [int(mr) for mr in mrs_to_deploy if int(mr) not in excluded_mrs]
        skipped = [int(mr) for mr in mrs_to_deploy if int(mr) in excluded_mrs]
        if skipped:
            print("Locally dropped MRs (skipped):", *skipped)
        succeeded = original_merge_mrs(selected, tested, *merge_args, **merge_kwargs)
        deployed_mrs.extend(int(mr) for mr in succeeded)
        return succeeded

    bot.fetch_mr_data = tracked_fetch_mr_data
    bot.merge_mrs = tracked_merge_mrs
    if args.mode == "mk2":
        bot.main([])
    else:
        bot.main()

    for branch_entry in manual_branches:
        branch_name = str(branch_entry.get("branch", ""))
        clone_url = str(branch_entry.get("cloneUrl", ""))
        project_path = str(branch_entry.get("projectPath", ""))
        print(f"Fetching manually added branch {project_path}:{branch_name}...")
        fetch_result = subprocess.run(
            ["git", "fetch", "--force", clone_url, branch_name],
            cwd=server_root,
            capture_output=True,
            text=True,
            errors="replace",
        )
        if fetch_result.returncode != 0:
            print(fetch_result.stderr.strip() or fetch_result.stdout.strip())
            print(f"Manual branch {branch_name} could not be fetched and was not deployed.")
            branch_entry["deployed"] = False
            continue
        print(f"Merging manually added branch {branch_name} on top of the MR stack...")
        merge_result = subprocess.run(
            ["git", "merge", "--no-edit", "--no-ff", "FETCH_HEAD"],
            cwd=server_root,
            capture_output=True,
            text=True,
            errors="replace",
        )
        if merge_result.stdout.strip():
            print(merge_result.stdout.strip())
        if merge_result.returncode != 0:
            print(merge_result.stderr.strip())
            print(f"Manual branch {branch_name} failed to merge and was not deployed.")
            subprocess.run(["git", "merge", "--abort"], cwd=server_root, capture_output=True)
            branch_entry["deployed"] = False
            continue
        branch_entry["deployed"] = True
        print(f"Manually added branch {branch_name} deployed successfully.")

    manual_branches_path.parent.mkdir(parents=True, exist_ok=True)
    manual_branches_path.write_text(json.dumps(manual_branches, indent=2), encoding="utf-8")
    unique_mrs = list(dict.fromkeys(deployed_mrs))
    visible_mrs = unique_mrs + sorted(excluded_mrs - set(unique_mrs))
    manifest = [
        {
            "iid": mr,
            "url": f"https://gitlab.com/2009scape/2009scape/-/merge_requests/{mr}",
            "title": mr_metadata.get(mr, previous_metadata.get(mr, {})).get("title", ""),
            "labels": mr_metadata.get(mr, previous_metadata.get(mr, {})).get("labels", []),
            "author": mr_metadata.get(mr, previous_metadata.get(mr, {})).get("author", ""),
            "dropped": mr in excluded_mrs,
        }
        for mr in visible_mrs
    ]
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
