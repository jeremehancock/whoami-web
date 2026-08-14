#!/usr/bin/env python3
"""
Regenerates the resume section of this site from jeremehancock.com's data.json,
which is the single source of truth for the resume.

Owns three things and nothing else:

    content/resume/experience.txt     from data.json "resume" (type: work)
    content/resume/skills.txt         from data.json "skills"
    resume/education.txt              from data.json "resume" (type: education),
                                      rewritten in place inside content.json

Everything else in content.json is hand-written and left untouched: the resume
directory README, download.txt, the profile block, and all the prose.

The script hard-fails on any key or entry type it does not recognize. That is
the point: when data.json grows a field, this stops rather than silently
dropping it from the terminal.

Usage:
    ./scripts/sync-resume.py              # fetch live data.json, write files
    ./scripts/sync-resume.py --check      # exit 1 if anything is out of date
    ./scripts/sync-resume.py --source path/to/data.json
"""

import argparse
import json
import sys
import textwrap
import urllib.error
import urllib.request
from pathlib import Path

DATA_URL = "https://jeremehancock.com/data/data.json"
ROOT = Path(__file__).resolve().parent.parent
WIDTH = 72

# Navigation footers. These are whoami-web's own concern -- there is no
# equivalent in data.json -- so they live here as constants.
SEE_ALSO = {
    "experience": "See also:  cat resume/skills.txt  ·  cat resume/education.txt",
    "skills": "See also:  cat resume/experience.txt  ·  cat resume/education.txt",
    "education": "See also:  cat resume/experience.txt  ·  cat resume/skills.txt",
}

WORK_KEYS = {"type", "company", "position", "website", "startDate", "endDate", "highlights"}
EDUCATION_KEYS = {"type", "institution", "url", "area", "studyType", "highlights"}
HIGHLIGHT_KEYS = {"text", "url", "linkLabel"}
SKILL_KEYS = {"name", "icon", "keywords", "evidence"}


class SchemaError(Exception):
    """data.json contains something this script was not taught to render."""


def check_keys(entry, allowed, label):
    unknown = set(entry) - allowed
    if unknown:
        raise SchemaError(
            f"{label} has unrecognized key(s): {', '.join(sorted(unknown))}\n"
            f"  Teach {Path(__file__).name} how to render them, then re-run."
        )


def require(entry, key, label):
    if key not in entry or entry[key] in (None, ""):
        raise SchemaError(f"{label} is missing required key '{key}'")
    return entry[key]


def wrap(text, width, indent, subsequent=None):
    """Wrap text to width, with a prefix on the first line and continuations."""
    return textwrap.wrap(
        text,
        width=width,
        initial_indent=indent,
        subsequent_indent=subsequent if subsequent is not None else indent,
        break_long_words=False,
        break_on_hyphens=False,
    )


def pack(items, width, indent, separator=" · "):
    """Greedily fill lines with separator-joined items.

    textwrap would happily break right before a separator and leave a '·'
    dangling at the start of a line, so pack by item instead.
    """
    lines, current = [], []
    for item in items:
        candidate = current + [item]
        if current and len(indent) + len(separator.join(candidate)) > width:
            lines.append(indent + separator.join(current))
            current = [item]
        else:
            current = candidate
    if current:
        lines.append(indent + separator.join(current))
    return lines


def date_range(entry, label):
    start = require(entry, "startDate", label)
    end = entry.get("endDate") or "present"
    if end.lower() == "present":
        end = "present"
    return f"{start} – {end}"


def render_highlights(highlights, label):
    """Render a highlight list as '    - ...' bullets, URLs on their own line."""
    lines = []
    for item in highlights:
        if isinstance(item, str):
            lines += wrap(item, WIDTH, "    - ", "      ")
        elif isinstance(item, dict):
            check_keys(item, HIGHLIGHT_KEYS, f"{label} highlight")
            lines += wrap(require(item, "text", f"{label} highlight"), WIDTH, "    - ", "      ")
            if item.get("url"):
                # linkLabel is deliberately unused: the terminal linkifies raw
                # URLs, so the bare URL is the clickable thing.
                lines.append("      " + item["url"])
        else:
            raise SchemaError(f"{label} has a highlight that is neither string nor object")
    return lines


def render_experience(work):
    """Group consecutive roles at the same company under one header."""
    groups = []
    for job in work:
        if groups and groups[-1][0] == job["company"]:
            groups[-1][1].append(job)
        else:
            groups.append((job["company"], [job]))

    lines = ["resume - experience", "===================", ""]

    for company, roles in groups:
        website = roles[0].get("website")
        label = f"resume entry for {company}"

        # A single undated-company role (freelance-style) reads better with the
        # date range in the header. Anything else gets the uniform layout.
        if not website and len(roles) == 1:
            lines.append(f"{company}  ·  {date_range(roles[0], label)}")
            lines.append("  " + require(roles[0], "position", label))
            lines += render_highlights(roles[0].get("highlights", []), label)
            lines.append("")
            continue

        lines.append(f"{company}  ·  {website}" if website else company)

        pad = max(len(date_range(r, label)) for r in roles) + 3
        for i, role in enumerate(roles):
            if i:
                lines.append("")
            lines.append("  " + date_range(role, label).ljust(pad) + require(role, "position", label))
            lines += render_highlights(role.get("highlights", []), label)
        lines.append("")

    lines.append(SEE_ALSO["experience"])
    return "\n".join(lines) + "\n"


def render_skills(skills):
    lines = ["resume - skills", "===============", ""]

    for skill in skills:
        name = require(skill, "name", "skill")
        check_keys(skill, SKILL_KEYS, f"skill '{name}'")
        lines.append(name)
        # icon is a Font Awesome class for the main site; meaningless here.
        keywords = require(skill, "keywords", f"skill '{name}'")
        lines += pack(keywords, WIDTH, "  ")
        if skill.get("evidence"):
            lines += wrap(skill["evidence"], WIDTH, "    ")
        lines.append("")

    lines.append(SEE_ALSO["skills"])
    return "\n".join(lines) + "\n"


def render_education(entries):
    lines = ["resume - education", "=================="]

    for edu in entries:
        institution = require(edu, "institution", "education entry")
        check_keys(edu, EDUCATION_KEYS, f"education entry for {institution}")
        lines.append("")
        lines.append(institution)
        degree = ", ".join(p for p in (edu.get("studyType"), edu.get("area")) if p)
        if degree:
            lines.append("  " + degree)
        lines += render_highlights(edu.get("highlights", []), f"education entry for {institution}")
        if edu.get("url"):
            lines += ["", "  " + edu["url"]]

    lines += ["", SEE_ALSO["education"]]
    return lines


def load_data(source):
    if source:
        return json.loads(Path(source).read_text(encoding="utf-8"))
    with urllib.request.urlopen(DATA_URL, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def partition(resume):
    """Split the resume array into work and education, validating as we go."""
    work, education = [], []
    for entry in resume:
        kind = entry.get("type")
        if kind == "work":
            check_keys(entry, WORK_KEYS, f"resume entry for {entry.get('company', '?')}")
            require(entry, "company", "resume entry")
            work.append(entry)
        elif kind == "education":
            education.append(entry)
        else:
            raise SchemaError(f"resume entry has unrecognized type: {kind!r}")
    return work, education


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", help="read data.json from a local path instead of the live site")
    parser.add_argument("--check", action="store_true", help="report drift and exit 1 without writing")
    args = parser.parse_args()

    try:
        data = load_data(args.source)
        work, education = partition(data["resume"])
        outputs = {
            ROOT / "content/resume/experience.txt": render_experience(work),
            ROOT / "content/resume/skills.txt": render_skills(data["skills"]),
        }
        education_lines = render_education(education)
    except SchemaError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except KeyError as exc:
        print(f"error: data.json is missing a required top-level key: {exc}", file=sys.stderr)
        return 2
    except (OSError, json.JSONDecodeError) as exc:
        # URLError subclasses OSError, so this covers both fetch and file reads.
        print(f"error: could not read resume data: {exc}", file=sys.stderr)
        return 2

    content_path = ROOT / "content.json"
    content = json.loads(content_path.read_text(encoding="utf-8"))
    content["tree"]["resume"]["education.txt"] = education_lines
    outputs[content_path] = json.dumps(content, indent=2, ensure_ascii=False) + "\n"

    stale = [p for p, text in outputs.items() if not p.exists() or p.read_text(encoding="utf-8") != text]

    if args.check:
        for path in stale:
            print(f"out of date: {path.relative_to(ROOT)}")
        print("resume is up to date" if not stale else f"{len(stale)} file(s) need syncing")
        return 1 if stale else 0

    for path in stale:
        path.write_text(outputs[path], encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)}")

    if not stale:
        print("already up to date, nothing written")
    else:
        print("\nReview with `git diff`, then commit.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
