# Portal Management Guide

## Purpose

`Master Data > Portal Management` is available only to Super Admin. It controls the Dashboard, menus, tables, page text, and translation availability without removing operational source data.

## Supported actions

- Show or hide a menu, tab, field, or table column.
- Reorder items within the same surface.
- Maintain separate Indonesian and English labels.
- Add a custom field or column with a controlled data type.
- Mark a field as required.
- Preview a configuration before publishing it.
- Publish a configuration version for audit tracking.
- Grant Dashboard access and individual widget visibility by role.
- Activate ID-only or ID+EN mode after translation review.

## Protected data rule

Core identifiers, relationships, verification fields, API mapping keys, report dependencies, and audit fields cannot be deleted. Hidden fields remain available to the system. Custom items also use Archive/Restore rather than destructive deletion.

## Production requirement

The current package stores builder configuration locally for prototype testing. Tim IT should move published configuration, version history, approval records, and rollback data to the production backend and database.
