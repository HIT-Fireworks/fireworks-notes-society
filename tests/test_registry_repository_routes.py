import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


generator = load_module(
    "course_cluster_overrides",
    ROOT / "scripts" / "apply-course-cluster-overrides.py",
)
validator = load_module(
    "registry_validation",
    ROOT / "scripts" / "validate-registry.py",
)
publisher = load_module(
    "registry_publisher",
    ROOT / "scripts" / "publish-registry-cutover.py",
)


class RegistryRepositoryRoutesTest(unittest.TestCase):
    def test_generation_six_uses_only_repository_routes(self):
        routes = json.loads(
            (ROOT / "config" / "repository-file-routes.v4.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(routes["generation"], 6)
        self.assertFalse(generator.FORBIDDEN_ROUTE_FIELDS & routes.keys())
        self.assertNotIn("course_code_routes", routes)
        self.assertEqual(len(routes["repository_routes"]), 16_454)
        self.assertTrue(
            all(
                set(route)
                == {"kind", "physical_repository_id", "repo_id", "route_key"}
                for route in routes["repository_routes"]
            )
        )
        self.assertEqual(
            sum(route["kind"] == "special-topic" for route in routes["repository_routes"]),
            18,
        )

    def test_issue_courses_route_to_approved_repositories(self):
        config = json.loads(generator.CONFIG.read_text(encoding="utf-8"))
        routes = json.loads(generator.ROUTES.read_text(encoding="utf-8"))
        by_key = {
            route["route_key"]: route
            for route in routes["repository_routes"]
            if route["kind"] == "curriculum-course"
        }
        self.assertEqual({issue["issue"] for issue in config["issues"]}, {18, 19})
        for issue in config["issues"]:
            for code in issue["requested_codes"]:
                self.assertEqual(by_key[code]["repo_id"], issue["target_repo_id"])
        self.assertNotIn(20, {issue["issue"] for issue in config["issues"]})

    def test_generator_is_byte_stable_on_generation_six(self):
        result = generator.build(False)
        self.assertEqual(
            generator.compact_bytes(result["manifest"]), generator.MANIFEST.read_bytes()
        )
        self.assertEqual(
            generator.compact_bytes(result["routes"]), generator.ROUTES.read_bytes()
        )
        self.assertEqual(
            generator.compact_bytes(result["topology"]), generator.TOPOLOGY.read_bytes()
        )
        self.assertEqual(result["report"]["descriptor_changed"], 0)
        self.assertEqual(result["report"]["record_changed"], 0)

    def test_registry_validator_accepts_repository_route_snapshot(self):
        result = validator.validate(ROOT)
        self.assertTrue(result["valid"])
        self.assertEqual(result["course_descriptor_count"], 16_436)
        self.assertEqual(result["repository_route_count"], 16_454)

    def test_publisher_uses_current_snapshot_and_generation_receipt(self):
        self.assertEqual(publisher.MANIFEST, ROOT / "data/repository-manifest.no-collection.v4.json")
        self.assertEqual(publisher.TOPOLOGY, ROOT / "config/repository-topology.v4.json")
        self.assertEqual(publisher.ROUTES, ROOT / "config/repository-file-routes.v4.json")
        self.assertEqual(publisher.RECEIPT.name, "registry-generation6-publish-verification.v1.json")
        self.assertIn("Git Tree", publisher.registry_readme().decode("utf-8"))
        self.assertNotIn("下载以当前 repository-file-routes", publisher.registry_readme().decode("utf-8"))
        identity = publisher.snapshot_identity(publisher.snapshot_store())
        self.assertRegex(identity, r"^[a-f0-9]{64}$")
        self.assertEqual(publisher.PARENT_REF, "refs/heads/generation-parent")
        self.assertNotIn("GIT_NO_LAZY_FETCH", publisher.ENV)

    def test_publisher_recovers_when_push_completed_before_receipt(self):
        receipt = {
            "snapshot_sha256": "a" * 64,
            "parent": "b" * 40,
            "head": "c" * 40,
            "status": "prepared",
        }
        recovered = publisher.reconcile_receipt(receipt, "a" * 64, "c" * 40)
        self.assertEqual(recovered["status"], "completed")
        self.assertIn("published_at", recovered)
        self.assertEqual(receipt["status"], "prepared")


if __name__ == "__main__":
    unittest.main()
