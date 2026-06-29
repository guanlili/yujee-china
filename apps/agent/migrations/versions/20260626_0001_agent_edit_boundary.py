"""create agent edit boundary tables

Revision ID: 20260626_0001
Revises:
Create Date: 2026-06-26
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260626_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("create extension if not exists pgcrypto")
    op.execute("create schema if not exists agent")

    op.create_table(
        "edit_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("album_id", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("session_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("album_id", name="uq_agent_edit_sessions_album_id"),
        schema="agent",
    )

    op.create_table(
        "edit_ops",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("op_id", sa.Text(), nullable=False),
        sa.Column("album_id", sa.Text(), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("payload_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["session_id"], ["agent.edit_sessions.id"], name="fk_agent_edit_ops_session_id"),
        sa.UniqueConstraint("op_id", name="uq_agent_edit_ops_op_id"),
        sa.CheckConstraint(
            "kind in ('write_chapter', 'edit_text', 'swap_image', 'swap_layout', 'advance')",
            name="ck_agent_edit_ops_kind",
        ),
        sa.CheckConstraint("status in ('pending', 'committed')", name="ck_agent_edit_ops_status"),
        schema="agent",
    )
    op.create_index(
        "idx_agent_edit_ops_album_status_created",
        "edit_ops",
        ["album_id", "status", "created_at"],
        schema="agent",
    )

    op.create_table(
        "edit_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("op_id", sa.Text(), nullable=True),
        sa.Column("album_id", sa.Text(), nullable=False),
        sa.Column("chapter_id", sa.Text(), nullable=True),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["op_id"], ["agent.edit_ops.op_id"], name="fk_agent_edit_messages_op_id"),
        sa.CheckConstraint("role in ('user', 'assistant')", name="ck_agent_edit_messages_role"),
        sa.CheckConstraint("status in ('pending', 'committed')", name="ck_agent_edit_messages_status"),
        schema="agent",
    )
    op.create_index(
        "idx_agent_edit_messages_history",
        "edit_messages",
        ["album_id", "chapter_id", "status", "created_at"],
        schema="agent",
    )
    op.create_index(
        "idx_agent_edit_messages_op_status",
        "edit_messages",
        ["op_id", "status"],
        schema="agent",
    )


def downgrade() -> None:
    op.drop_index("idx_agent_edit_messages_op_status", table_name="edit_messages", schema="agent")
    op.drop_index("idx_agent_edit_messages_history", table_name="edit_messages", schema="agent")
    op.drop_table("edit_messages", schema="agent")
    op.drop_index("idx_agent_edit_ops_album_status_created", table_name="edit_ops", schema="agent")
    op.drop_table("edit_ops", schema="agent")
    op.drop_table("edit_sessions", schema="agent")
    op.execute("drop schema if exists agent")
