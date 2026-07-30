"""KML export for the public share pages.

Nothing can write into a visitor's Google Maps saved places -- there is no API
for it. The closest real path is Google My Maps, which imports KML directly, so
that is what `/l/{slug}/map.kml` and `/t/{slug}/map.kml` serve.

Two details are load-bearing:

  1. KML coordinates are `longitude,latitude` -- the reverse of every other
     coordinate pair in this codebase. Getting it backwards silently plots
     Istanbul in Somalia.
  2. My Maps turns each `<Folder>` into its own layer with independently
     editable pin colors, so grouping by category is what makes the imported map
     usable rather than 50 identical pins.

Built with ElementTree rather than string templates so escaping is structural:
entry titles and notes are user input and routinely contain `&` and quotes.
"""

from xml.etree import ElementTree as ET

KML_NAMESPACE = "http://www.opengis.net/kml/2.2"
KML_MEDIA_TYPE = "application/vnd.google-earth.kml+xml"

# XML 1.0 has no escape for most C0 control characters -- they are simply not
# allowed in a document. ElementTree writes them out verbatim anyway, so a
# single stray one anywhere in a title or note makes the *whole* file
# unparseable and every My Maps import of that share fails. U+000B is the one
# that actually shows up: it is what pasting out of Word or a PDF leaves behind.
# Tab, newline and carriage return are the three C0 characters XML does allow.
_ILLEGAL_XML_CHARS: dict[int, None] = dict.fromkeys(
    [*range(0x00, 0x09), 0x0B, 0x0C, *range(0x0E, 0x20)]
)


class Placemark:
    """One exported place: a name, a description block, and a point."""

    def __init__(
        self,
        *,
        name: str,
        latitude: float,
        longitude: float,
        category: str,
        description_lines: list[str] | None = None,
    ) -> None:
        self.name = name
        self.latitude = latitude
        self.longitude = longitude
        self.category = category
        self.description_lines = [line for line in (description_lines or []) if line]


def build_kml(
    *,
    document_name: str,
    document_description: str | None,
    placemarks: list[Placemark],
) -> str:
    """Render placemarks as a KML document string, one folder per category.

    Folder order follows the order categories first appear in `placemarks`, so a
    caller that already sorted by the canonical category order gets that order
    preserved in My Maps' layer list.
    """
    ET.register_namespace("", KML_NAMESPACE)
    root = ET.Element(f"{{{KML_NAMESPACE}}}kml")
    document = ET.SubElement(root, "Document")

    _text_child(document, "name", document_name)
    if document_description:
        _text_child(document, "description", document_description)

    for category, group in _group_by_category(placemarks).items():
        folder = ET.SubElement(document, "Folder")
        _text_child(folder, "name", category)
        for placemark in group:
            _append_placemark(folder, placemark)

    ET.indent(root, space="  ")
    return ET.tostring(root, encoding="unicode", xml_declaration=True)


def _group_by_category(placemarks: list[Placemark]) -> dict[str, list[Placemark]]:
    """Bucket placemarks by category, preserving first-appearance order."""
    grouped: dict[str, list[Placemark]] = {}
    for placemark in placemarks:
        grouped.setdefault(placemark.category, []).append(placemark)
    return grouped


def _append_placemark(parent: ET.Element, placemark: Placemark) -> None:
    element = ET.SubElement(parent, "Placemark")
    _text_child(element, "name", placemark.name)

    if placemark.description_lines:
        _text_child(element, "description", "\n".join(placemark.description_lines))

    point = ET.SubElement(element, "Point")
    # Longitude first. See the module docstring.
    _text_child(
        point,
        "coordinates",
        f"{placemark.longitude},{placemark.latitude},0",
    )


def _text_child(parent: ET.Element, tag: str, text: str) -> ET.Element:
    """Add `<tag>text</tag>`, dropping characters XML cannot carry.

    Every user-supplied string in the document -- document name and
    description, folder names, placemark names and descriptions -- passes
    through here, so this is the one chokepoint that has to hold the line.
    """
    child = ET.SubElement(parent, tag)
    child.text = text.translate(_ILLEGAL_XML_CHARS)
    return child
