import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1]
MODULE_PATH = ROOT / "scripts" / "repository_description.py"
SPEC = importlib.util.spec_from_file_location("repository_description", MODULE_PATH)
assert SPEC and SPEC.loader
repository_description = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(repository_description)

class RepositoryDescriptionTest(unittest.TestCase):


    def test_complete_course_mapping_round_trips_in_description(self):
        mapping = {
            "22CS22002": "数理逻辑与近世代数",
            "22CS22038": "数理逻辑与近世代数C",
            "CS31114": "数理逻辑与近世代数",
        }
        description = repository_description.stable_repository_description(
            "course",
            "数理逻辑与近世代数",
            repo_id="COURSES-RA-ED4F15651BB9",
            course_mapping=mapping,
        )
        self.assertLessEqual(len(description), 350)
        semantic_name, encoded = description.split("｜", 1)
        self.assertEqual(semantic_name, "数理逻辑与近世代数")
        self.assertEqual(repository_description.decode_course_mapping(encoded), mapping)
        self.assertFalse(
            repository_description.description_contract_violations(
                description,
                repo_type="course",
                repo_id="COURSES-RA-ED4F15651BB9",
                course_mapping=mapping,
            )
        )

    def test_oversize_mapping_shows_complete_entries_and_marks_remainder(self):
        mapping = {f"22HS{i:05d}": f"原始课程名称{i}" for i in range(100)}
        description = repository_description.stable_repository_description(
            "course", "人文社科学部", course_mapping=mapping
        )
        self.assertLessEqual(len(description), 350)
        self.assertIn("｜22HS{", description)
        parsed = repository_description.parse_course_mapping_description(description)
        self.assertTrue(parsed["truncated"])
        self.assertGreater(len(parsed["shown_mapping"]), 0)
        self.assertEqual(
            len(parsed["shown_mapping"]) + parsed["remaining_count"], len(mapping)
        )
        normalized = dict(repository_description.normalize_course_mapping(mapping))
        self.assertEqual(
            list(parsed["shown_mapping"].items()),
            list(normalized.items())[: len(parsed["shown_mapping"])],
        )
        readme = repository_description.repository_readme(
            repo_type="course", course_mapping=mapping
        )
        for code, name in mapping.items():
            self.assertIn(f"| `{code}` | {name} |", readme)

    def test_noncanonical_truncation_is_rejected(self):
        mapping = {
            "22CS22002": "数理逻辑与近世代数",
            "22CS22038": "数理逻辑与近世代数C",
        }
        invalid = "数理逻辑与近世代数｜22CS{22002=数理逻辑与近世代数}｜…尚余1项"
        self.assertIn(
            "noncanonical-course-mapping-projection",
            repository_description.description_contract_violations(
                invalid, repo_type="course", course_mapping=mapping
            ),
        )


    def test_empty_label_is_removed_but_concrete_codes_remain_visible(self):
        mapping = {f"22CS{i:05d}": f"课程{i}" for i in range(100)}
        description = repository_description.stable_repository_description(
            "course",
            "计算学部 / 无资料课程",
            course_mapping=mapping,
        )
        self.assertTrue(description.startswith("计算学部｜22CS{"))
        self.assertNotIn("无资料", description)
        parsed = repository_description.parse_course_mapping_description(description)
        self.assertTrue(parsed["truncated"])
        self.assertGreater(len(parsed["shown_mapping"]), 0)
        self.assertEqual(
            len(parsed["shown_mapping"]) + parsed["remaining_count"], 100
        )

    def test_shared_description_is_unique_label(self):
        description = repository_description.stable_repository_description(
            "shared", "校内资源", repo_id="CAT-campus-resources"
        )
        self.assertEqual(description, "校内资源")
        self.assertNotIn("special-topic", description)
        self.assertNotIn("Registry", description)

    def test_template_description_rejects_obsolete_roles(self):
        old = "薪火笔记社 collection、shared、competition 与 software 仓库 v2 模板"
        self.assertEqual(
            repository_description.description_contract_violations(
                old,
                repo_type="template",
                repo_id="fireworks-collection-template-v2",
            ),
            ["obsolete-template-role-description"],
        )
        new = repository_description.stable_repository_description(
            "template",
            "薪火资料集合仓库模板 v2",
            repo_id="fireworks-collection-template-v2",
        )
        self.assertFalse(
            repository_description.description_contract_violations(
                new,
                repo_type="template",
                repo_id="fireworks-collection-template-v2",
            )
        )

    def test_inventory_coupled_descriptions_are_rejected(self):
        descriptions = (
            "流体力学课程资料（1 个逻辑资源分组，5 个课程代码）",
            "资料共享连通分量课程仓（2 个课程代码，2 个资料文件）",
            "计算学部 无资料课程代码集合（106 个代码；逐代码独立路由）",
        )
        for description in descriptions:
            with self.subTest(description=description):
                self.assertTrue(
                    repository_description.description_contract_violations(
                        description,
                        repo_type="course",
                    )
                )


if __name__ == "__main__":
    unittest.main()
