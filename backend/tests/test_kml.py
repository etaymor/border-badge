"""Tests for the KML builder used by the share pages' map export."""

from xml.etree import ElementTree as ET

from app.core.kml import KML_NAMESPACE, Placemark, build_kml

NS = {"kml": KML_NAMESPACE}


def _doc(xml: str) -> ET.Element:
    root = ET.fromstring(xml)
    document = root.find("kml:Document", NS)
    assert document is not None
    return document


def _placemark(
    name: str = "Karakoy Lokantasi",
    *,
    latitude: float = 41.0082,
    longitude: float = 28.9784,
    category: str = "Food",
    description_lines: list[str] | None = None,
) -> Placemark:
    return Placemark(
        name=name,
        latitude=latitude,
        longitude=longitude,
        category=category,
        description_lines=description_lines,
    )


def test_coordinates_are_longitude_first() -> None:
    """KML reverses the usual pair. Getting it wrong plots the wrong hemisphere."""
    xml = build_kml(
        document_name="Istanbul",
        document_description=None,
        placemarks=[_placemark(latitude=41.0082, longitude=28.9784)],
    )

    coordinates = _doc(xml).find(".//kml:coordinates", NS)
    assert coordinates is not None
    assert coordinates.text == "28.9784,41.0082,0"


def test_placemarks_are_grouped_into_one_folder_per_category() -> None:
    """My Maps turns each folder into an independently styleable layer."""
    xml = build_kml(
        document_name="Istanbul",
        document_description=None,
        placemarks=[
            _placemark("Hagia Sophia", category="Places"),
            _placemark("Karakoy Lokantasi", category="Food"),
            _placemark("Basilica Cistern", category="Places"),
        ],
    )

    folders = _doc(xml).findall("kml:Folder", NS)
    assert [folder.find("kml:name", NS).text for folder in folders] == [
        "Places",
        "Food",
    ]
    # Both Places entries land in the first folder, in the order given.
    first = folders[0].findall("kml:Placemark", NS)
    assert [mark.find("kml:name", NS).text for mark in first] == [
        "Hagia Sophia",
        "Basilica Cistern",
    ]
    assert len(folders[1].findall("kml:Placemark", NS)) == 1


def test_hostile_text_is_escaped_not_injected() -> None:
    """Titles and notes are user input: they reach the file as text, not markup."""
    xml = build_kml(
        document_name="Ali & Sons <b>trip</b>",
        document_description=None,
        placemarks=[
            _placemark(
                "</name><Placemark><name>injected",
                description_lines=["Tea & simit <script>alert(1)</script>"],
            )
        ],
    )

    assert "<script>" not in xml
    assert "&amp;" in xml

    document = _doc(xml)
    # Exactly one placemark: the closing tag in the title did not break out.
    assert len(document.findall(".//kml:Placemark", NS)) == 1
    assert (
        document.find(".//kml:Placemark/kml:name", NS).text
        == "</name><Placemark><name>injected"
    )
    assert document.find("kml:name", NS).text == "Ali & Sons <b>trip</b>"


def test_control_characters_do_not_break_the_document() -> None:
    """XML 1.0 cannot carry these at all, and one anywhere kills the whole file.

    U+000B is what a paste out of Word or a PDF leaves behind, so this is an
    ordinary note, not a hostile one -- and without stripping it the visitor's
    My Maps import fails with a parse error rather than a missing pin.
    """
    xml = build_kml(
        document_name="Istanbul\x0btrip",
        document_description="Two\x00trips",
        placemarks=[
            _placemark(
                "Karakoy\x0bLokantasi",
                category="Fo\x0cod",
                description_lines=["Great\x1fbreakfast"],
            )
        ],
    )

    # The point of the test: this parses at all.
    document = _doc(xml)
    assert document.find("kml:name", NS).text == "Istanbultrip"
    assert document.find("kml:description", NS).text == "Twotrips"
    assert document.find("kml:Folder/kml:name", NS).text == "Food"
    assert document.find(".//kml:Placemark/kml:name", NS).text == "KarakoyLokantasi"
    assert (
        document.find(".//kml:Placemark/kml:description", NS).text == "Greatbreakfast"
    )


def test_legal_whitespace_survives() -> None:
    """Tab, newline and carriage return are the C0 characters XML does allow."""
    xml = build_kml(
        document_name="Istanbul",
        document_description=None,
        placemarks=[_placemark(description_lines=["Karakoy", "Great\tbreakfast"])],
    )

    description = _doc(xml).find(".//kml:description", NS)
    assert description is not None
    assert description.text == "Karakoy\nGreat\tbreakfast"


def test_description_joins_only_the_lines_that_exist() -> None:
    """Blank place names, addresses and notes must not leave empty lines."""
    xml = build_kml(
        document_name="Istanbul",
        document_description=None,
        placemarks=[
            _placemark(description_lines=["Karakoy", "", None, "Great breakfast"])  # type: ignore[list-item]
        ],
    )

    description = _doc(xml).find(".//kml:description", NS)
    assert description is not None
    assert description.text == "Karakoy\nGreat breakfast"


def test_placemark_without_description_omits_the_element() -> None:
    """An empty <description> is noise in the My Maps import preview."""
    xml = build_kml(
        document_name="Istanbul",
        document_description=None,
        placemarks=[_placemark(description_lines=[])],
    )

    placemark = _doc(xml).find(".//kml:Placemark", NS)
    assert placemark is not None
    assert placemark.find("kml:description", NS) is None


def test_document_name_and_description_are_carried() -> None:
    xml = build_kml(
        document_name="Istanbul",
        document_description="Highlights from two trips",
        placemarks=[_placemark()],
    )

    document = _doc(xml)
    assert document.find("kml:name", NS).text == "Istanbul"
    assert document.find("kml:description", NS).text == "Highlights from two trips"


def test_empty_collection_still_produces_valid_kml() -> None:
    """A list whose entries all lack coordinates downloads as an empty map."""
    xml = build_kml(document_name="Istanbul", document_description=None, placemarks=[])

    document = _doc(xml)
    assert document.findall("kml:Folder", NS) == []
    assert document.find("kml:name", NS).text == "Istanbul"
