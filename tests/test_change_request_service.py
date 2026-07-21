"""Unit tests for form layout change request state machine."""

from __future__ import annotations

import json
import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from backend.change_request_service import promote_pending_request
from backend.models import FieldDefinition


def _sample_field() -> FieldDefinition:
    return FieldDefinition(
        field_key="notes",
        label="Notes",
        field_type="textarea",
        sort_order=0,
        is_required=False,
        schema_version=0,
        is_published=False,
    )


class PromotePendingRequestTest(unittest.TestCase):
    @patch("backend.change_request_service.set_status")
    @patch("backend.change_request_service.execute")
    @patch("backend.change_request_service.repository")
    @patch("backend.change_request_service.get_request")
    def test_approve_inserts_schema_version(
        self,
        mock_get_request: MagicMock,
        mock_repository: MagicMock,
        mock_execute: MagicMock,
        mock_set_status: MagicMock,
    ) -> None:
        field = _sample_field()
        mock_get_request.return_value = {
            "request_id": "req-1",
            "project_id": "proj-1",
            "status": "pending",
            "proposed_fields": [field],
            "requested_by": "editor@example.com",
            "requested_at": datetime.now(timezone.utc),
            "schema_version": 1,
            "updated_at": datetime.now(timezone.utc),
            "updated_by": "editor@example.com",
        }
        mock_repository.get_project.return_value = {
            "project_id": "proj-1",
            "schema_version": 2,
        }
        mock_repository.list_fields.return_value = [field]
        mock_set_status.return_value = {
            "request_id": "req-1",
            "project_id": "proj-1",
            "status": "draft",
            "proposed_fields": [field],
            "requested_by": "editor@example.com",
            "requested_at": datetime.now(timezone.utc),
            "schema_version": 1,
            "updated_at": datetime.now(timezone.utc),
            "updated_by": "admin@example.com",
        }

        result = promote_pending_request(
            "proj-1",
            "req-1",
            "admin@example.com",
            "Looks good",
        )

        mock_repository.replace_draft_fields.assert_called_once_with(
            "proj-1",
            [field],
            "admin@example.com",
        )
        mock_execute.assert_called_once()
        sql, params = mock_execute.call_args[0]
        self.assertIn("schema_versions", sql)
        self.assertEqual(params[0], "proj-1")
        self.assertEqual(params[1], 3)
        snapshot = json.loads(params[2])
        self.assertEqual(snapshot[0]["field_key"], "notes")
        self.assertEqual(params[4], "admin@example.com")
        mock_set_status.assert_called_once_with(
            "proj-1",
            "req-1",
            "draft",
            "admin@example.com",
            "Looks good",
        )
        self.assertEqual(result["schema_version"], 3)
        self.assertEqual(result["request"]["status"], "draft")

    @patch("backend.change_request_service.get_request")
    def test_approve_rejects_non_pending(self, mock_get_request: MagicMock) -> None:
        mock_get_request.return_value = {
            "request_id": "req-1",
            "project_id": "proj-1",
            "status": "draft",
            "proposed_fields": [],
            "requested_by": "editor@example.com",
            "requested_at": datetime.now(timezone.utc),
            "schema_version": 1,
            "updated_at": datetime.now(timezone.utc),
            "updated_by": "editor@example.com",
        }

        with self.assertRaises(ValueError) as ctx:
            promote_pending_request("proj-1", "req-1", "admin@example.com")

        self.assertIn("pending", str(ctx.exception).lower())


if __name__ == "__main__":
    unittest.main()
