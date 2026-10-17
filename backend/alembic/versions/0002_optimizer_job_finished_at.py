"""Add finished_at to optimizer_jobs for terminal retention.

Revision ID: 0002_job_finished_at
Revises: 0001_initial
Create Date: 2026-03-21

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002_job_finished_at"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "optimizer_jobs",
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        op.f("ix_optimizer_jobs_finished_at"),
        "optimizer_jobs",
        ["finished_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_optimizer_jobs_finished_at"), table_name="optimizer_jobs")
    op.drop_column("optimizer_jobs", "finished_at")
