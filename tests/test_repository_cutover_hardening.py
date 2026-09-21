import hashlib
import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).parents[1]
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))


def load_module(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


complete = load_module("complete_repository_cutover", "complete-repository-cutover.py")
flat = load_module("execute_flat_repository_migration", "execute-flat-repository-migration.py")


class RepositoryCutoverHardeningTest(unittest.TestCase):
    def test_only_noncategory_empty_placeholders_are_removed(self):
        routed = {"临时/.gitkeep"}
        for category in complete.CATEGORY_DIRECTORIES:
            path = f"{category}/.gitkeep"
            self.assertFalse(
                complete.should_remove_placeholder(
                    path, {"sha": complete.EMPTY_BLOB_SHA1}, set()
                )
            )
            self.assertFalse(
                flat.should_remove_placeholder(path, flat.EMPTY_BLOB_SHA1, set())
            )
        self.assertFalse(
            complete.should_remove_placeholder(
                "临时/.gitkeep", {"sha": complete.EMPTY_BLOB_SHA1}, routed
            )
        )
        self.assertFalse(
            complete.should_remove_placeholder(
                "临时/.gitkeep", {"sha": "f" * 40}, set()
            )
        )
        self.assertTrue(
            complete.should_remove_placeholder(
                "临时/.gitkeep", {"sha": complete.EMPTY_BLOB_SHA1}, set()
            )
        )
        self.assertTrue(
            flat.should_remove_placeholder(
                "临时/.gitkeep", flat.EMPTY_BLOB_SHA1, set()
            )
        )

    def test_description_retry_accepts_remote_success_after_timeout(self):
        complete.SPECS = {
            "COURSE": {
                "repo_type": "course",
                "display_name": "课程",
                "course_codes": ["AA100"],
            }
        }
        complete.NAMES = {"AA100": "课程 A"}
        expected = complete.stable_repository_description(
            "course",
            "课程",
            repo_id="COURSE",
            course_mapping={"AA100": "课程 A"},
        )
        checkpoint = Mock()
        with patch.object(
            complete,
            "api",
            side_effect=[RuntimeError("request timeout"), {"description": expected}],
        ) as api, patch.object(complete, "checkpoint", checkpoint):
            complete.synchronize_description("COURSE", {"description": "旧说明"})
        self.assertEqual(api.call_count, 2)
        checkpoint.assert_called_once_with(
            "COURSE", "metadata", {"status": "completed", "description": expected}
        )

    def test_final_verification_checks_readme_description_actions_and_files(self):
        repo = "COURSE"
        target_path = "笔记/复习.pdf"
        complete.SPECS = {
            repo: {
                "repo_type": "course",
                "display_name": "课程",
                "course_codes": ["AA100"],
            }
        }
        complete.NAMES = {"AA100": "课程 A"}
        complete.BY_REPO = {
            repo: [
                {
                    "target_path": target_path,
                    "source_mode": "100644",
                    "source_blob_sha1": "a" * 40,
                    "size": 42,
                }
            ]
        }
        complete.PLAN = {
            "identity_sha256": "b" * 64,
            "files": [
                {
                    "source_repo_id": "SOURCE",
                    "source_path": "旧/复习.pdf",
                    "target_repo_id": repo,
                    "previous_target_path": "legacy-imports/复习.pdf",
                    "target_path": target_path,
                    "size": 42,
                }
            ],
        }
        description = complete.stable_repository_description(
            "course",
            "课程",
            repo_id=repo,
            course_mapping={"AA100": "课程 A"},
        )
        complete.STATE = {
            "repositories": {
                repo: {
                    "cleanup": {
                        "status": "completed",
                        "head": "c" * 40,
                        "tree": "d" * 40,
                    },
                    "metadata": {
                        "status": "completed",
                        "description": description,
                    },
                }
            }
        }
        readme = complete.metadata(repo).encode()
        readme_sha = hashlib.sha1(
            f"blob {len(readme)}\0".encode() + readme
        ).hexdigest()
        entries = {
            target_path: {
                "mode": "100644",
                "type": "blob",
                "sha": "a" * 40,
                "size": 42,
            },
            "README.md": {"mode": "100644", "type": "blob", "sha": readme_sha},
            **{
                path: {
                    "mode": "100644",
                    "type": "blob",
                    "sha": complete.EMPTY_BLOB_SHA1,
                    "size": 0,
                }
                for path in complete.CATEGORY_PLACEHOLDER_PATHS
            },
        }
        saved = Mock()
        with patch.object(complete, "head", return_value="c" * 40), patch.object(
            complete, "tree", return_value=("d" * 40, entries)
        ), patch.object(
            complete,
            "identity",
            return_value={"description": description},
        ), patch.object(
            complete, "api", return_value={"enabled": False}
        ), patch.object(complete, "save", saved):
            complete.verify(final=True)
        name, result = saved.call_args.args
        self.assertEqual(name, "final-content-verification.json")
        self.assertTrue(result["valid"])
        self.assertEqual(result["files"], 1)
        self.assertEqual(result["bytes"], 42)


if __name__ == "__main__":
    unittest.main()
