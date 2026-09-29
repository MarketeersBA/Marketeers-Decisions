"""Initial catalog schema (clients, studies, optimizer_jobs).

Revision ID: 0001_initial
Revises:
Create Date: 2026-03-20

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "clients",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("cognito_sub", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("cognito_sub"),
    )
    op.create_table(
        "studies",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("client_id", sa.String(length=36), nullable=False),
        sa.Column("slug", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=512), nullable=False),
        sa.Column("company", sa.String(length=512), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("client_id", "slug", name="uq_studies_client_slug"),
    )
    op.create_index(op.f("ix_studies_client_id"), "studies", ["client_id"], unique=False)
    op.create_table(
        "optimizer_jobs",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("client_id", sa.String(length=36), nullable=False),
        sa.Column("study_id", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("evals", sa.Integer(), nullable=False),
        sa.Column("estimated_evals", sa.Integer(), nullable=False),
        sa.Column("best_obj", sa.Float(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"]),
        sa.ForeignKeyConstraint(["study_id"], ["studies.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_optimizer_jobs_client_id"), "optimizer_jobs", ["client_id"], unique=False)
    op.create_index(op.f("ix_optimizer_jobs_study_id"), "optimizer_jobs", ["study_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_optimizer_jobs_study_id"), table_name="optimizer_jobs")
    op.drop_index(op.f("ix_optimizer_jobs_client_id"), table_name="optimizer_jobs")
    op.drop_table("optimizer_jobs")
    op.drop_index(op.f("ix_studies_client_id"), table_name="studies")
    op.drop_table("studies")
    op.drop_table("clients")
