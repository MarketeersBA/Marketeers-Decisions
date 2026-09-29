"""Loading a named scenario must run the share pipeline once, not per SKU attribute."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from data.scenario_store import ScenarioData
from model.project_core import ProjectCore


class ApplyScenarioReloadTests(unittest.TestCase):
    def test_apply_scenario_reloads_results_once(self) -> None:
        project = ProjectCore.__new__(ProjectCore)
        project._model = object()
        project.scenario_name = ""
        calls = {"n": 0}

        def _reload() -> None:
            calls["n"] += 1

        with (
            patch.object(project, "reset_products") as reset,
            patch.object(project, "change_product_attribute") as change,
            patch.object(project, "include_exclude_product") as include,
            patch.object(project, "apply_segmentation_filters") as seg,
            patch.object(project, "reload_results", side_effect=_reload),
        ):
            scenario = ScenarioData(
                name="Noor SF -10%",
                product_overrides={
                    "A": {"Price": 10, "WD": 100},
                    "B": {"Price": 12, "WD": 90},
                },
                included_products={"A": True, "B": False},
                segmentation={"Region": "KSA"},
            )
            project.apply_scenario(scenario)

        reset.assert_called_once_with(reload=False)
        self.assertEqual(change.call_count, 4)
        self.assertTrue(all(c.kwargs.get("reload") is False for c in change.call_args_list))
        self.assertEqual(include.call_count, 2)
        self.assertTrue(all(c.kwargs.get("reload") is False for c in include.call_args_list))
        seg.assert_called_once()
        self.assertIs(seg.call_args.kwargs.get("reload"), False)
        self.assertEqual(calls["n"], 1)
        self.assertEqual(project.scenario_name, "Noor SF -10%")


if __name__ == "__main__":
    unittest.main()
