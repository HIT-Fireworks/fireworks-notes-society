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


validator = load_module(
    "registry_validation",
    ROOT / "scripts" / "validate-registry.py",
)
publisher = load_module(
    "registry_publisher",
    ROOT / "scripts" / "publish-registry-cutover.py",
)
metadata_publisher = load_module(
    "course_cluster_metadata_publisher",
    ROOT / "scripts" / "publish-course-cluster-metadata.py",
)


class RegistryRepositoryRoutesTest(unittest.TestCase):
    def test_generation_six_uses_only_repository_routes(self):
        routes = json.loads(
            (ROOT / "config" / "repository-file-routes.v4.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(routes["generation"], 6)
        self.assertNotIn("files", routes)
        self.assertNotIn("course_code_routes", routes)
        self.assertNotIn("repository_heads", routes)
        self.assertEqual(len(routes["repository_routes"]), 16_454)
        self.assertTrue(
            all(
                set(route) == {"kind", "physical_repository_id", "repo_id", "route_key"}
                for route in routes["repository_routes"]
            )
        )
        self.assertEqual(
            sum(route["kind"] == "special-topic" for route in routes["repository_routes"]),
            18,
        )

    def test_generation_six_does_not_persist_old_algorithm_provenance(self):
        manifest = json.loads(
            (ROOT / "data" / "repository-manifest.no-collection.v4.json").read_text(
                encoding="utf-8"
            )
        )
        routes = json.loads(
            (ROOT / "config" / "repository-file-routes.v4.json").read_text(
                encoding="utf-8"
            )
        )
        topology = json.loads(
            (ROOT / "config" / "repository-topology.v4.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertNotIn("course_cluster_overrides", manifest.get("sources", {}))
        self.assertNotIn("source_course_cluster_overrides_sha256", routes)
        self.assertNotIn("source_course_cluster_overrides_sha256", topology)

    def test_registry_validator_accepts_repository_route_snapshot(self):
        result = validator.validate(ROOT)
        self.assertTrue(result["valid"])
        self.assertEqual(result["course_descriptor_count"], 16_436)
        self.assertEqual(result["repository_route_count"], 16_454)


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

    def test_metadata_publisher_derives_all_affected_repositories(self):
        topology, _manifest, _names = metadata_publisher.current_snapshot()
        _baseline_ref, baseline = metadata_publisher.previous_topology(
            topology["generation"]
        )
        self.assertEqual(
            metadata_publisher.affected_repository_ids(baseline, topology),
            [
                "22MA15024",
                "COURSES-MIG-C0683EE403A5",
                "COURSES-RA-43B4396AA956",
                "COURSES-RA-ABB94F5BF175",
            ],
        )

    def test_metadata_identity_ignores_registry_only_commits(self):
        plan = {
            "generation": 6,
            "baseline_ref": "a" * 40,
            "registry_head": "b" * 40,
            "repositories": {
                "COURSE": {
                    "repo_id": "COURSE",
                    "course_code_count": 1,
                    "description": "课程｜AA{100=课程 A}",
                    "readme_blob_sha1": "c" * 40,
                },
            },
        }
        identity = metadata_publisher.plan_identity(plan)
        plan["registry_head"] = "d" * 40
        self.assertEqual(metadata_publisher.plan_identity(plan), identity)
        plan["repositories"]["COURSE"]["readme_blob_sha1"] = "e" * 40
        self.assertNotEqual(metadata_publisher.plan_identity(plan), identity)


if __name__ == "__main__":
    unittest.main()
