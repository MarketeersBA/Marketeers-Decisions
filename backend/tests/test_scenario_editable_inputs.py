"""Tests ensuring capture_scenario and apply_scenario preserve all editable fields."""

from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from data.scenario_store import ScenarioData
from model.project_core import ProjectCore


class ScenarioEditableInputsTests(unittest.TestCase):
    def test_capture_scenario_includes_discrete_nos_tdc(self) -> None:
        project = ProjectCore.__new__(ProjectCore)
        project.use_grouping = False
        project.financial = True

        p1 = SimpleNamespace(
            name="Product A",
            included=True,
            new_attributes={"Price": 25.5},
            new_wd=85.0,
            discrete_levels={"Pack Size": 2, "Flavor": 3},
            new_nos=18.5,
            new_tdc=12.0,
        )
        p2 = SimpleNamespace(
            name="Product B",
            included=False,
            new_attributes={"Price": 10.0},
            new_wd=50.0,
            discrete_levels={"Pack Size": 1},
            new_nos=None,
            new_tdc=None,
        )

        mock_model = MagicMock()
        mock_model.products = [p1, p2]
        project._model = mock_model

        with patch.object(project, "_segmentation_dict", return_value={"Region": "KSA"}):
            scenario = project.capture_scenario("Test Scenario", "Description")

        self.assertIn("Product A", scenario.product_overrides)
        ov_a = scenario.product_overrides["Product A"]
        self.assertEqual(ov_a["Price"], 25.5)
        self.assertEqual(ov_a["WD"], 85.0)
        self.assertEqual(ov_a["Pack Size"], 2)
        self.assertEqual(ov_a["Flavor"], 3)
        self.assertEqual(ov_a["NOS"], 18.5)
        self.assertEqual(ov_a["TDC"], 12.0)

        ov_b = scenario.product_overrides["Product B"]
        self.assertEqual(ov_b["Price"], 10.0)
        self.assertEqual(ov_b["WD"], 50.0)
        self.assertEqual(ov_b["Pack Size"], 1)
        self.assertNotIn("NOS", ov_b)
        self.assertNotIn("TDC", ov_b)
        self.assertEqual(scenario.included_products, {"Product A": True, "Product B": False})
        self.assertEqual(scenario.segmentation, {"Region": "KSA"})

    def test_apply_scenario_restores_captured_scenario(self) -> None:
        project = ProjectCore.__new__(ProjectCore)
        project._model = MagicMock()
        project.scenario_name = ""

        scenario = ScenarioData(
            name="Roundtrip Test",
            product_overrides={
                "Product A": {
                    "Price": 25.5,
                    "WD": 85.0,
                    "Pack Size": 2,
                    "Flavor": 3,
                    "NOS": 18.5,
                    "TDC": 12.0,
                }
            },
            included_products={"Product A": True},
            segmentation={"Region": "KSA"},
        )

        with (
            patch.object(project, "reset_products") as reset,
            patch.object(project, "change_product_attribute") as change,
            patch.object(project, "include_exclude_product") as include,
            patch.object(project, "apply_segmentation_filters") as seg,
            patch.object(project, "reload_results") as reload_results,
        ):
            project.apply_scenario(scenario)

        reset.assert_called_once_with(reload=False)
        expected_calls = {
            ("Product A", "Price", "25.5"),
            ("Product A", "WD", "85.0"),
            ("Product A", "Pack Size", "2"),
            ("Product A", "Flavor", "3"),
            ("Product A", "NOS", "18.5"),
            ("Product A", "TDC", "12.0"),
        }
        actual_calls = {(c.args[0], c.args[1], c.args[2]) for c in change.call_args_list}
        self.assertEqual(actual_calls, expected_calls)
        include.assert_called_once_with("Product A", True, reload=False)
        seg.assert_called_once_with([("Region", "KSA")], reload=False)
        reload_results.assert_called_once()
        self.assertEqual(project.scenario_name, "Roundtrip Test")


if __name__ == "__main__":
    unittest.main()
