"""
================================================================================
FILE: test_cleaning.py
MODULE: tests/unit/
PURPOSE: Unit tests for app/data/cleaning.py — compute_cleaning_stats,
         handle_nulls, handle_outliers, remove_duplicates.
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CREATED: 2026-05-12
LAST MODIFIED: 2026-05-12
VERSION: 0.5.1
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

import numpy as np
import pandas as pd
import pytest

from app.data.cleaning import (
    apply_log_transform,
    compute_cleaning_stats,
    handle_nulls,
    handle_outliers,
    remove_duplicates,
)


# ─── FIXTURES ─────────────────────────────────────────────────────────────────


@pytest.fixture()
def df_clean():
    """10-row clean DataFrame with no nulls, no duplicates, no extreme outliers."""
    return pd.DataFrame({
        "x1": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0],
        "x2": [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
        "y":  [2.0, 4.0, 6.0, 8.0, 10.0, 12.0, 14.0, 16.0, 18.0, 20.0],
    })


@pytest.fixture()
def df_with_nulls():
    """8 clean rows + 2 rows with nulls (row 8 and 9)."""
    df = pd.DataFrame({
        "x1": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, None, None],
        "x2": [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, None],
        "y":  [2.0, 4.0, 6.0, 8.0, 10.0, 12.0, 14.0, 16.0, 18.0, 20.0],
    })
    return df


@pytest.fixture()
def df_with_duplicates():
    """8 unique rows + row 0 repeated twice (2 duplicates)."""
    base = pd.DataFrame({
        "x1": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0],
        "x2": [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
        "y":  [2.0, 4.0, 6.0, 8.0, 10.0, 12.0, 14.0, 16.0],
    })
    extra = pd.DataFrame({"x1": [1.0, 1.0], "x2": [0.1, 0.1], "y": [2.0, 2.0]})
    return pd.concat([base, extra], ignore_index=True)


@pytest.fixture()
def df_with_outliers():
    """9 normal rows + 1 extreme outlier in x1 (value = 1000)."""
    return pd.DataFrame({
        "x1": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 1000.0],
        "x2": [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
        "y":  [2.0, 4.0, 6.0, 8.0, 10.0, 12.0, 14.0, 16.0, 18.0, 20.0],
    })


# ─── compute_cleaning_stats ───────────────────────────────────────────────────


def test_stats_clean_dataset(df_clean):
    """Clean DataFrame reports zeros for all cleaning counts."""
    stats = compute_cleaning_stats(df_clean)
    assert stats["null_rows"] == 0
    assert stats["duplicate_rows"] == 0


def test_stats_null_rows(df_with_nulls):
    """Reports correct number of rows with at least one null."""
    stats = compute_cleaning_stats(df_with_nulls)
    assert stats["null_rows"] == 2


def test_stats_duplicate_rows(df_with_duplicates):
    """Reports correct number of duplicate rows."""
    stats = compute_cleaning_stats(df_with_duplicates)
    assert stats["duplicate_rows"] == 2


def test_stats_outlier_rows(df_with_outliers):
    """Reports at least 1 outlier row when extreme value is present."""
    stats = compute_cleaning_stats(df_with_outliers)
    assert stats["outlier_rows"] >= 1


def test_stats_returns_dict_keys(df_clean):
    """Return dict always contains all three expected keys."""
    stats = compute_cleaning_stats(df_clean)
    assert set(stats.keys()) == {"null_rows", "duplicate_rows", "outlier_rows"}


# ─── handle_nulls ─────────────────────────────────────────────────────────────


def test_nulls_drop_rows(df_with_nulls):
    """drop_rows removes rows with nulls and returns correct count."""
    result, affected = handle_nulls(df_with_nulls, "drop_rows")
    assert result.isnull().sum().sum() == 0
    assert len(result) == len(df_with_nulls) - 2
    assert affected == 2


def test_nulls_mean_impute_preserves_rows(df_with_nulls):
    """mean_impute fills nulls without removing rows."""
    result, affected = handle_nulls(df_with_nulls, "mean_impute")
    assert len(result) == len(df_with_nulls)
    assert result.isnull().sum().sum() == 0
    assert affected == 2


def test_nulls_median_impute_preserves_rows(df_with_nulls):
    """median_impute fills nulls without removing rows."""
    result, affected = handle_nulls(df_with_nulls, "median_impute")
    assert len(result) == len(df_with_nulls)
    assert result.isnull().sum().sum() == 0


def test_nulls_clean_dataset_noop(df_clean):
    """drop_rows on a clean dataset returns the same DataFrame unchanged."""
    result, affected = handle_nulls(df_clean, "drop_rows")
    assert len(result) == len(df_clean)
    assert affected == 0


def test_nulls_source_not_mutated(df_with_nulls):
    """handle_nulls never mutates the source DataFrame."""
    original_null_count = df_with_nulls.isnull().sum().sum()
    handle_nulls(df_with_nulls, "drop_rows")
    assert df_with_nulls.isnull().sum().sum() == original_null_count


def test_nulls_unknown_strategy_raises(df_clean):
    """Passing an unknown strategy raises ValueError."""
    with pytest.raises(ValueError, match="Unknown null strategy"):
        handle_nulls(df_clean, "interpolate")


# ─── handle_outliers ──────────────────────────────────────────────────────────


def test_outliers_keep_noop(df_with_outliers):
    """keep strategy returns identical DataFrame with 0 rows affected."""
    result, affected = handle_outliers(df_with_outliers, "keep")
    assert len(result) == len(df_with_outliers)
    assert affected == 0


def test_outliers_drop_rows_removes_extreme(df_with_outliers):
    """drop_rows removes the extreme outlier row."""
    result, affected = handle_outliers(df_with_outliers, "drop_rows")
    assert 1000.0 not in result["x1"].values
    assert affected >= 1


def test_outliers_drop_rows_clean_dataset(df_clean):
    """drop_rows on a dataset with no extreme outliers removes nothing or few rows."""
    result, affected = handle_outliers(df_clean, "drop_rows")
    assert len(result) >= 5   # must always leave at least MIN_ROWS to be useful


def test_outliers_source_not_mutated(df_with_outliers):
    """handle_outliers never mutates the source DataFrame."""
    original_len = len(df_with_outliers)
    handle_outliers(df_with_outliers, "drop_rows")
    assert len(df_with_outliers) == original_len


def test_outliers_unknown_strategy_raises(df_clean):
    """Passing an unknown strategy raises ValueError."""
    with pytest.raises(ValueError, match="Unknown outlier strategy"):
        handle_outliers(df_clean, "winsorize")


# ─── remove_duplicates ────────────────────────────────────────────────────────


def test_remove_duplicates(df_with_duplicates):
    """Removes the 2 duplicate rows, keeps the first occurrence."""
    result, removed = remove_duplicates(df_with_duplicates)
    assert removed == 2
    assert len(result) == len(df_with_duplicates) - 2
    assert result.duplicated().sum() == 0


def test_remove_duplicates_clean_dataset(df_clean):
    """Returns identical DataFrame when no duplicates are present."""
    result, removed = remove_duplicates(df_clean)
    assert removed == 0
    assert len(result) == len(df_clean)


def test_remove_duplicates_source_not_mutated(df_with_duplicates):
    """remove_duplicates never mutates the source DataFrame."""
    original_len = len(df_with_duplicates)
    remove_duplicates(df_with_duplicates)
    assert len(df_with_duplicates) == original_len


# ─── apply_log_transform ──────────────────────────────────────────────────────


@pytest.fixture()
def df_skewed():
    """10-row DataFrame with a right-skewed column (x1 spans 1–1000)."""
    return pd.DataFrame({
        "x1": [1.0, 2.0, 3.0, 4.0, 5.0, 10.0, 20.0, 50.0, 200.0, 1000.0],
        "x2": [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
        "y":  [2.0, 4.0, 6.0, 8.0, 10.0, 12.0, 14.0, 16.0, 18.0, 20.0],
    })


def test_log_transform_basic(df_skewed):
    """apply_log_transform applies log1p to selected columns."""
    result, n = apply_log_transform(df_skewed, ["x1"])
    assert n == 1
    assert len(result) == len(df_skewed)
    expected_first = np.log1p(1.0)
    assert abs(result["x1"].iloc[0] - expected_first) < 1e-10
    # Untouched columns unchanged
    assert list(result["x2"]) == list(df_skewed["x2"])


def test_log_transform_source_not_mutated(df_skewed):
    """apply_log_transform never mutates the source DataFrame."""
    original_max = df_skewed["x1"].max()
    apply_log_transform(df_skewed, ["x1"])
    assert df_skewed["x1"].max() == original_max


def test_log_transform_zero_values_ok(df_clean):
    """Columns with zero values are valid — log1p(0) = 0."""
    df = df_clean.copy()
    df["x1"] = [0.0] * len(df)
    result, n = apply_log_transform(df, ["x1"])
    assert (result["x1"] == 0.0).all()
    assert n == 1


def test_log_transform_negative_values_rejected(df_clean):
    """ValueError raised when a selected column contains values <= -1."""
    df = df_clean.copy()
    df.loc[0, "x1"] = -2.0
    with pytest.raises(ValueError, match="values"):
        apply_log_transform(df, ["x1"])


def test_log_transform_unknown_column_raises(df_clean):
    """ValueError raised when a column name is not in the DataFrame."""
    with pytest.raises(ValueError, match="Unknown column"):
        apply_log_transform(df_clean, ["does_not_exist"])
