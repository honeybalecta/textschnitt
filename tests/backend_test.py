#!/usr/bin/env python3
"""Prüfungen des Backends ohne Browser: sicheres Speichern, frühere Fassungen, Papierkorb, Speicher verwalten,
alle Projekte sichern und einspielen, Projekt weitergeben, Vorschaubild der Projektliste, Textzeile und Untertitel im Export,
Hinweis auf neue Versionen, Fehlerbericht.
Läuft in einem frischen Datenordner; nichts verlässt den Rechner (GitHub ist nachgestellt).
Aufruf: python3 tests/backend_test.py"""
import gzip
import json
import os
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODE = sys.argv[1] if len(sys.argv) > 1 else "alles"
TMP = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(tempfile.mkdtemp(prefix="honeycut-test-"))
os.environ["TEXTSCHNITT_DATA"] = str(TMP / ("umzug" if MODE == "umzug" else "daten"))
os.environ["HF_HUB_CACHE"] = str(TMP / "hf")
os.environ["HONEYCUT_UPDATE_API"] = "test://releases"
sys.path.insert(0, str(Path(os.environ.get("HC_REPO") or HERE.parent)))
import textschnitt as T  # noqa: E402

T.log = lambda msg: None      # das Protokoll der Prüfungen selbst interessiert hier nicht
N = BAD = 0


def chk(name, ok, extra=""):
    global N, BAD
    N += 1
    BAD += not ok
    print(("ok     " if ok else "FEHLER ") + name + (f" · {extra}" if extra != "" else ""), flush=True)


def mk(p: Path, data, age=3600):
    """Datei anlegen – als wäre sie schon eine Stunde alt (frisch erzeugte Dateien gelten dem Speicher-Aufräumen als „in Arbeit“)."""
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data if isinstance(data, bytes) else data.encode("utf-8"))
    if age:
        t = time.time() - age
        os.utime(p, (t, t))


def proj(pid):
    return json.loads((T.PROJ_DIR / f"{pid}.json").read_text(encoding="utf-8"))


def job():
    return {"cancel": False, "progress": 0, "message": ""}


D = T.DATA_DIR
ZIP = str(TMP / "sicherung.zip")


def speichern_und_fassungen():
    T.save_project("s1", json.dumps({"id": "s1", "name": "Erster Stand", "updated": 1000, "deleted": []}))
    chk("Projekt wird gespeichert und wieder gelesen", json.loads(T.load_project("s1"))["name"] == "Erster Stand")
    for bad, why in (('{"id": "s1", "name": "abgeschn', "abgeschnittener Stand"), ('{"name": "ohne Kennung"}', "Stand ohne Kennung"), ("[]", "kein Projekt")):
        try:
            T.save_project("s1", bad)
            chk(f"{why} wird abgewiesen", False)
        except ValueError:
            chk(f"{why} wird abgewiesen, der letzte gute Stand bleibt", proj("s1")["name"] == "Erster Stand")
    # Fassungen: der vorige Stand wird zurückgelegt, höchstens sechs bleiben
    f = T.proj_path("s1")
    for k in range(8):
        T.backup_project(f, force=True)
        T.save_project("s1", json.dumps({"id": "s1", "name": f"Stand {k}", "updated": 2000 + k, "deleted": list(range(k))}), backup=False)
    vs = T.project_versions("s1")
    chk("es bleiben die letzten sechs Fassungen, jüngste zuerst", len(vs) == 6 and [v["name"] for v in vs][:2] == ["Stand 6", "Stand 5"] and vs[0]["cut"] == 6, [v["name"] for v in vs])
    chk("zwei Sicherungen in derselben Sekunde überschreiben einander nicht", len({v["file"] for v in vs}) == 6)
    # unlesbare Projektdatei: beim Öffnen kommt die jüngste Fassung zurück
    f.write_bytes(b"\x00\x00kaputt")
    got = json.loads(T.load_project("s1"))
    chk("unlesbares Projekt wird beim Öffnen aus der jüngsten Fassung wiederhergestellt", got["name"] == "Stand 6" and proj("s1")["name"] == "Stand 6", got["name"])
    # Fassung als Kopie und an Ort und Stelle
    r = T.restore_version("s1", vs[3]["file"], True)
    chk("Fassung als Kopie: eigenes Projekt, Original unberührt", r["id"] != "s1" and proj(r["id"])["name"].startswith("Stand 3 (Fassung vom") and proj("s1")["name"] == "Stand 6")
    n = len(T.project_versions("s1"))
    T.restore_version("s1", vs[3]["file"], False)
    chk("Fassung zurückholen: der bisherige Stand liegt danach selbst bei den Fassungen", proj("s1")["name"] == "Stand 3" and T.project_versions("s1")[0]["name"] == "Stand 6" and len(T.project_versions("s1")) <= max(n + 1, 6))
    try:
        T.restore_version("s1", "../../etc/passwd", False)
        chk("erfundener Dateiname wird abgewiesen", False)
    except ValueError:
        chk("erfundener Dateiname wird abgewiesen", True)
    # Papierkorb
    T.delete_project(r["id"])
    T.delete_project("s1")
    tl = T.trash_list()
    chk("gelöschte Projekte liegen im Papierkorb (30 Tage)", sorted(t["id"] for t in tl) == sorted(["s1", r["id"]]) and all(t["left"] == 30 for t in tl) and T.trash_count() == 2, [(t["id"], t["left"]) for t in tl])
    T.trash_restore("s1")
    chk("Wiederherstellen bringt den letzten Stand zurück", proj("s1")["name"] == "Stand 3" and T.trash_count() == 1)
    try:
        T.trash_restore("s1")
        chk("vorhandenes Projekt wird nicht überschrieben", False)
    except ValueError:
        chk("vorhandenes Projekt wird nicht überschrieben", True)
    T.trash_purge(r["id"])
    chk("endgültig löschen entfernt nur das gemeinte Projekt", T.trash_count() == 0 and T.proj_path("s1").exists() and T.project_versions("s1"))
    # nach 30 Tagen räumt der Start von selbst auf
    T.save_project("alt", json.dumps({"id": "alt", "name": "Altes", "updated": 1}))
    T.delete_project("alt")
    old = time.time() - 31 * 86400
    for x in (T.BACKUP_DIR / "alt").iterdir():
        os.utime(x, (old, old))
    os.utime(T.BACKUP_DIR / "alt", (old, old))
    check, T.update_check = T.update_check, lambda force=False: None     # das Aufräumen stößt sonst die Versionsprüfung an
    T.housekeeping()
    T.update_check = check
    chk("Papierkorb leert sich nach 30 Tagen von selbst", not (T.BACKUP_DIR / "alt").exists() and T.proj_path("s1").exists())
    T.delete_project("s1")
    T.trash_purge(None)


def speicher():
    px, mt, fo = T.CACHE_DIR / "proxies", D / "freigestellt", D / "folien"
    for k in range(40):
        mk(T.CACHE_DIR / "thumbs" / f"t{k}.jpg", b"x" * 2000)
    mk(px / "aaaaaaaaaaaaaaaa.mp4", b"x" * 3_000_000)      # von p1 verwendet
    mk(px / "bbbbbbbbbbbbbbbb.mp4", b"x" * 4_000_000)      # verwaist
    mk(mt / "cccccccccccccccc.mp4", b"x" * 500_000)        # von p1 verwendet
    mk(mt / "dddddddddddddddd.mp4", b"x" * 600_000)        # nur in einer früheren Fassung von p1
    mk(mt / "eeeeeeeeeeeeeeee.mp4", b"x" * 700_000)        # verwaist
    mk(fo / "p1" / "folie-s1-3.png", b"x" * 100_000)
    mk(fo / "p1" / "folie-s1-2.png", b"x" * 90_000)
    mk(fo / "p1" / "folie-s1-1.png", b"x" * 80_000)
    mk(fo / "p1" / "folienbild-x.png", b"x" * 70_000)
    mk(fo / "weg" / "folie-z9-1.png", b"x" * 60_000)       # das Projekt gibt es nicht mehr
    mk(fo / "trash1" / "folie-q7-1.png", b"x" * 50_000)    # das Projekt liegt im Papierkorb
    p1 = {"id": "p1", "name": "Rede zum Haushalt", "sources": [{"uri": str(mt / "cccccccccccccccc.mp4"), "proxy": str(px / "aaaaaaaaaaaaaaaa.mp4"), "duration": 60}],
          "items": [{"clip": {"uri": str(fo / "p1" / "folie-s1-3.png")}}, {"clip": {"uri": str(fo / "p1" / "folienbild-x.png")}}]}
    mk(T.PROJ_DIR / "p1.json", json.dumps(p1))
    old = dict(p1, sources=[{"uri": str(mt / "dddddddddddddddd.mp4")}], items=[{"clip": {"uri": str(fo / "p1" / "folie-s1-2.png")}}])
    mk(T.BACKUP_DIR / "p1" / "20261101-100000.json.gz", gzip.compress(json.dumps(old).encode()))
    mk(T.BACKUP_DIR / "trash1" / "20261110-100000-geloescht.json.gz", gzip.compress(json.dumps({"id": "trash1", "name": "Altes", "items": [{"clip": {"uri": str(fo / "trash1" / "folie-q7-1.png")}}]}).encode()))
    mk(TMP / "hf" / "models--mobiuslabsgmbh--faster-whisper-large-v3-turbo" / "blobs" / "m.bin", b"x" * 900_000)
    info = T.storage_info()
    g = {x["key"]: x for x in info["groups"]}
    chk("Übersicht: Größen aller Gruppen und freier Platz", g["thumbs"]["count"] == 40 and g["proxies"]["bytes"] == 7_000_000 and g["matte"]["bytes"] == 1_800_000 and g["slides"]["count"] == 6
        and g["models"]["bytes"] == 900_000 and info["free"] > 0 and not info["problem"], {k: v["bytes"] for k, v in g.items()})
    chk("Vorschau-Dateien: nur die verwaiste ist freigebbar", g["proxies"]["nfree"] == 1 and g["proxies"]["freeable"] == 4_000_000)
    used = {i["name"][:1]: i["used"] for i in g["matte"]["items"]}
    chk("freigestellte Kopien: Verwendung in Projekt und früherer Fassung wird genannt", used == {"c": ["„Rede zum Haushalt“"], "d": ["einer früheren Fassung von „Rede zum Haushalt“"], "e": []}, used)
    chk("Folienbilder: frühere Bilder freigebbar; Papierkorb und frühere Fassungen zählen als verwendet", g["slides"]["nfree"] == 2 and g["slides"]["freeable"] == 140_000)
    r = T.storage_clear("proxies")
    chk("Vorschau-Dateien löschen: nur die verwaiste", r["count"] == 1 and (px / "aaaaaaaaaaaaaaaa.mp4").exists() and not (px / "bbbbbbbbbbbbbbbb.mp4").exists())
    r = T.storage_clear("matte", "cccccccccccccccc.mp4")
    chk("verwendete freigestellte Kopie lässt sich nicht löschen", r["count"] == 0 and (mt / "cccccccccccccccc.mp4").exists())
    r = T.storage_clear("matte")
    chk("unbenutzte freigestellte Kopie wird gelöscht, die übrigen bleiben", r["count"] == 1 and r["freed"] == 700_000 and (mt / "dddddddddddddddd.mp4").exists() and not (mt / "eeeeeeeeeeeeeeee.mp4").exists())
    r = T.storage_clear("slides")
    left = sorted(x.name for x in fo.rglob("*.png"))
    chk("Folienbilder: frühere weg, verwendete und eigene bleiben, leerer Ordner entfernt", r["count"] == 2 and left == ["folie-q7-1.png", "folie-s1-2.png", "folie-s1-3.png", "folienbild-x.png"] and not (fo / "weg").exists(), left)
    r = T.storage_clear("thumbs")
    chk("Vorschaubilder leeren", r["count"] == 40 and r["freed"] == 80_000)
    # eben erst erzeugte Dateien stehen womöglich noch in keinem gespeicherten Projekt: Sie bleiben liegen
    mk(mt / "1212121212121212.mp4", b"x" * 1000, age=0)
    mk(px / "3434343434343434.mp4", b"x" * 1000, age=0)
    mk(fo / "p1" / "folie-neu-1.png", b"x" * 1000, age=0)
    g = {x["key"]: x for x in T.storage_info()["groups"]}
    fresh = next(i for i in g["matte"]["items"] if i["name"].startswith("1212"))
    n = sum(T.storage_clear(w)["count"] for w in ("matte", "proxies", "slides")) + T.storage_clear("matte", "1212121212121212.mp4")["count"]
    chk("eben erst erzeugte Dateien gelten als in Arbeit und bleiben liegen", g["matte"]["nfree"] == 0 and g["proxies"]["nfree"] == 0 and g["slides"]["nfree"] == 0 and "laufenden Vorgang" in fresh["used"][0]
        and n == 0 and (mt / "1212121212121212.mp4").exists() and (px / "3434343434343434.mp4").exists() and (fo / "p1" / "folie-neu-1.png").exists(), fresh["used"])
    for x in (mt / "1212121212121212.mp4", px / "3434343434343434.mp4", fo / "p1" / "folie-neu-1.png"):
        x.unlink()
    r = T.storage_clear("model", "large-v3-turbo")
    chk("nachgeladenes Modell löschen", r["freed"] == 900_000 and not list((TMP / "hf").glob("models--*")))
    for what in ("unsinn", "model"):
        try:
            T.storage_clear(what, "gibt-es-nicht")
            chk(f"unbekannte Angabe ({what}) wird abgewiesen", False)
        except ValueError:
            chk(f"unbekannte Angabe ({what}) wird abgewiesen", True)
    mk(mt / "ffffffffffffffff.mp4", b"x" * 1000)
    mk(T.PROJ_DIR / "kaputt.json", b"\xff\xfe\x00")
    try:
        T.storage_clear("matte")
        chk("unlesbares Projekt: es wird nichts gelöscht", False)
    except Exception:  # noqa: BLE001
        chk("unlesbares Projekt: es wird nichts gelöscht", (mt / "ffffffffffffffff.mp4").exists())
    info = T.storage_info()
    chk("unlesbares Projekt: die Übersicht erklärt, warum nichts freigebbar ist", bool(info["problem"]) and all(not x.get("nfree") for x in info["groups"]))
    (T.PROJ_DIR / "kaputt.json").unlink()
    for x in (T.PROJ_DIR / "p1.json", mt / "ffffffffffffffff.mp4"):
        x.unlink()
    T._list_cache.clear()
    T.trash_purge(None)


def sicherung():
    mk(T.FONT_DIR / "Meine Schrift.ttf", b"FONT-A" * 100)
    mk(T.FONT_DIR / "Zweite.otf", b"FONT-B" * 50)
    f1 = T.norm_path(str(T.FONT_DIR / "Meine Schrift.ttf"))
    key1 = "u" + T._js_hash(f1)
    s1, s2, s3 = (T.norm_path(str(D / "folien" / a / b)) for a, b in (("b1", "folie-a1-2.png"), ("b1", "eigenes-bild.png"), ("andere", "folie-z-1.png")))
    mk(Path(s1), b"\x89PNG-1" * 1000)
    mk(Path(s2), b"\x89PNG-2" * 500)
    mk(Path(s3), b"\x89PNG-3" * 200)
    mk(D / "folien" / "b1" / "folie-a1-1.png", b"\x89PNG-alt")           # früheres Bild, von keinem Projekt verwendet
    mk(D / "freigestellt" / "9999999999999999.mp4", b"V" * 2_000_000)     # Videos bleiben draußen
    T.save_project("b1", json.dumps({"id": "b1", "name": "Rede zum Haushalt", "updated": 2000, "sources": [{"uri": "/videos/rede.mp4", "name": "rede.mp4", "duration": 60}],
                                     "sub_style": {"font": key1}, "items": [{"font": key1, "clip": {"uri": s1}}, {"clip": {"uri": s3}}], "slides": [{"img": s2}],
                                     "tokens": [{"type": "word", "text": "u1abc"}]}, ensure_ascii=False))
    T.save_project("b2", json.dumps({"id": "b2", "name": "Interview", "updated": 3000, "sources": [{"uri": str(D / "freigestellt" / "9999999999999999.mp4"), "orig": "/videos/interview.mp4"}]}))
    T.save_project("b3", json.dumps({"id": "b3", "name": "Kurzclip", "updated": 4000, "sources": []}))
    mk(T.PROJ_DIR / "kaputt.json", b"{nicht lesbar")
    r = T.backup_all_job(job(), ZIP, {"hc-colfav": ["#E5402A"], "hc-slide-profiles": [{"id": "mein", "name": "Mein Profil", "colors": {}}],
                                      "hc-fillers": ["halt", "ich sag mal"], "hc-sub-looks": [{"id": "l1", "name": "Kampagne", "st": {"font": key1, "color": "#EDE7DA"}}]})
    with zipfile.ZipFile(ZIP) as z:
        names, meta = sorted(z.namelist()), json.loads(z.read("sicherung.json"))
    chk("Sicherung enthält Projekte, verwendete Bilder, Schriften, Einstellungen – ohne Videos und ohne unbenutzte Bilder",
        names == ["einstellungen.json", "folien/andere/folie-z-1.png", "folien/b1/eigenes-bild.png", "folien/b1/folie-a1-2.png", "projekte/b1.json", "projekte/b2.json",
                  "projekte/b3.json", "schriften/Meine Schrift.ttf", "schriften/Zweite.otf", "sicherung.json"], names)
    chk("Ergebnis stimmt; ein unlesbares Projekt wird genannt und hält nichts auf", r["projects"] == 3 and r["slides"] == 3 and r["fonts"] == 2 and r["skipped"] == ["kaputt"]
        and meta["format"] == "honeycut-sicherung" and r["bytes"] < 200_000 and not Path(ZIP + ".part").exists(), r)
    (T.PROJ_DIR / "kaputt.json").unlink()
    # Zustand danach: b2 gelöscht, b3 hier neuer, b1 hier älter
    T.delete_project("b2")
    o = proj("b3")
    o.update(updated=9000, name="Kurzclip (weiterbearbeitet)")
    T.save_project("b3", json.dumps(o), backup=False)
    o = proj("b1")
    o.update(updated=1000, name="Rede (alter Stand)")
    T.save_project("b1", json.dumps(o), backup=False)
    r = T.backup_restore_job(job(), ZIP)
    chk("Einspielen: Fehlendes kommt dazu, Älteres wird aktualisiert, Neueres bleibt", r["added"] == ["Interview"] and r["updated"] == ["Rede zum Haushalt"] and r["updatedIds"] == ["b1"]
        and r["kept"] == ["Kurzclip"] and r["same"] == 0 and not r["failed"] and r["total"] == 3, {k: r[k] for k in ("added", "updated", "kept", "same", "failed")})
    chk("der überschriebene Stand liegt bei den früheren Fassungen", proj("b1")["name"] == "Rede zum Haushalt" and [v["name"] for v in T.project_versions("b1")] == ["Rede (alter Stand)"])
    chk("das hier neuere Projekt bleibt; der gesicherte Stand liegt bei seinen Fassungen", proj("b3")["name"] == "Kurzclip (weiterbearbeitet)" and [v["name"] for v in T.project_versions("b3")] == ["Kurzclip"])
    chk("das gelöschte Projekt ist zurück und aus dem Papierkorb verschwunden", proj("b2")["name"] == "Interview" and T.trash_list() == [])
    chk("gleicher Datenordner: Pfade und Schriftschlüssel bleiben", proj("b1")["items"][0]["clip"]["uri"] == s1 and proj("b1")["sub_style"]["font"] == key1 and r["fonts"] == 0 and r["slides"] == 0)
    chk("Designprofile und Farbfavoriten kommen mit zurück", r["prefs"]["hc-colfav"] == ["#E5402A"] and r["prefs"]["hc-slide-profiles"][0]["id"] == "mein")
    chk("eigene Füllwörter und Looks kommen mit zurück", r["prefs"]["hc-fillers"] == ["halt", "ich sag mal"] and r["prefs"]["hc-sub-looks"][0]["st"] == {"font": key1, "color": "#EDE7DA"})
    r = T.backup_restore_job(job(), ZIP)
    chk("zweites Einspielen ändert nichts und legt keine doppelten Fassungen an", r["same"] == 2 and r["kept"] == ["Kurzclip"] and not r["added"] and not r["updated"]
        and len(T.project_versions("b3")) == 1 and len(T.project_versions("b1")) == 1)
    for src, why in ((str(T.PROJ_DIR / "b1.json"), "fremde Datei"), (str(TMP / "fremd.zip"), "fremdes ZIP")):
        if why == "fremdes ZIP":
            with zipfile.ZipFile(src, "w") as zz:
                zz.writestr("irgendwas.txt", "x")
        try:
            T.backup_restore_job(job(), src)
            chk(f"{why} wird abgewiesen", False)
        except ValueError as e:
            chk(f"{why} wird abgewiesen", "keine HoneyCut-Sicherung" in str(e))
    with zipfile.ZipFile(TMP / "boese.zip", "w") as zz:
        zz.writestr("sicherung.json", json.dumps({"format": "honeycut-sicherung", "dataDir": T.norm_path(str(D))}))
        zz.writestr("projekte/../../raus.json", json.dumps({"id": "raus"}))
        zz.writestr("folien/../../../x.png", "x")
        zz.writestr("schriften/../boese.ttf", "x")
        zz.writestr("projekte/ok1.json", json.dumps({"id": "ok1", "name": "Gut", "updated": 5}))
        zz.writestr("projekte/leer.json", "[]")
    r = T.backup_restore_job(job(), str(TMP / "boese.zip"))
    chk("Pfade außerhalb des Datenordners werden nicht geschrieben, Unlesbares wird übersprungen", r["added"] == ["Gut"] and r["failed"] == ["leer"] and not (D.parent / "raus.json").exists()
        and not (D / "raus.json").exists() and not (T.FONT_DIR.parent / "boese.ttf").exists() and sorted(x.name for x in T.PROJ_DIR.glob("*.json")) == ["b1.json", "b2.json", "b3.json", "ok1.json"])
    # dieselbe Sicherung auf einem „anderen Rechner“ (anderer Datenordner) einspielen
    (TMP / "umzug.json").write_text(json.dumps({"key1": key1}))
    out = subprocess.run([sys.executable, __file__, "umzug", str(TMP)], capture_output=True, text=True)
    print(out.stdout, end="")
    global N, BAD
    N += out.stdout.count("\nok ") + out.stdout.startswith("ok ") + out.stdout.count("FEHLER ")
    BAD += out.stdout.count("FEHLER ") + (1 if out.returncode not in (0, 1) else 0)
    if out.returncode not in (0, 1):
        print("FEHLER Einspielen im anderen Datenordner lief nicht durch:", out.stderr[-600:])


def projektpakete():
    """Projekt weitergeben (.honeycut): Was kein Dateipfad ist – etwa ein Bild, das direkt im Projekt steht –, darf weder das
    Paket noch das Freigeben der übrigen Dateien aufhalten. Windows meldet bei mehr als 32 767 Zeichen „stat: path too long
    for Windows“ (ein ValueError); das wird hier nachgestellt, weil andere Systeme an dieser Stelle anders reagieren."""
    import pathlib
    real_resolve = pathlib.Path.resolve

    def win_resolve(self, strict=False):
        if len(str(self)) > 32767:
            raise ValueError("stat: path too long for Windows")
        return real_resolve(self, strict=strict)
    pathlib.Path.resolve = win_resolve
    os.environ["HOME"] = str(TMP / "heim")
    try:
        inline = "data:image/png;base64," + "iVBORw0KGgo/" * 4000          # 48 000 Zeichen, mit Schrägstrichen wie in echten Bilddaten
        try:
            got = T.norm_path(inline)
        except ValueError as e:
            got = f"Abbruch: {e}"
        chk("eingebettete Bilddaten gelten nicht als Dateipfad und bleiben unverändert", got == inline, got[:60])
        vid, logo = TMP / "paket" / "video.mp4", TMP / "paket" / "logo.png"
        mk(vid, b"v" * 5000)
        mk(logo, b"l" * 700)
        obj = {"id": "pk1", "name": "Paket", "sources": [{"uri": inline}, {"uri": str(vid)}], "items": [{"clip": {"uri": str(logo)}}, {"clip": {"uri": inline}}]}
        T.ALLOWED.clear()
        T.allow_all(obj)
        chk("beim Laden werden alle echten Dateien freigegeben, auch wenn daneben eingebettete Daten stehen",
            T.norm_path(str(vid)) in T.ALLOWED and T.norm_path(str(logo)) in T.ALLOWED and inline not in T.ALLOWED, len(T.ALLOWED))
        dest = str(TMP / "paket" / "projekt.honeycut")
        spec = {"name": "Paket", "header": {"format": "honeycut-projekt", "v": 1, "name": "Paket",
                                             "project": {"id": "pk1", "name": "Paket", "slides": [{"id": "s1", "img": inline}]},
                                             "files": [{"n": "m0", "kind": "media", "name": "video.mp4"}, {"n": "m1", "kind": "media", "name": "Datei1"},
                                                       {"n": "m2", "kind": "media", "name": "logo.png"}, {"n": "m3", "kind": "media", "name": "fehlt.mp4"}]},
                "files": [{"n": "m0", "uri": str(vid), "include": True}, {"n": "m1", "uri": inline, "include": True},
                          {"n": "m2", "uri": str(logo), "include": True}, {"n": "m3", "uri": str(TMP / "paket" / "fehlt.mp4"), "include": True}]}
        try:
            res = T.package_export_job(job(), spec, dest)
            err = ""
        except Exception as e:  # noqa: BLE001
            res, err = {}, repr(e)
        hf = {h["n"]: h for h in spec["header"]["files"]}
        chk("das Paket entsteht, auch wenn ein Eintrag eingebettete Daten statt eines Pfads nennt", not err and Path(dest).is_file(), err)
        chk("echte Dateien stecken im Paket, der eingebettete Eintrag und die fehlende Datei zählen als nicht mitgeschickt",
            hf["m0"].get("included") is True and hf["m2"].get("included") is True and hf["m1"].get("included") is False and hf["m3"].get("included") is False
            and hf["m0"].get("size") == 5000 and hf["m2"].get("size") == 700, {k: (v.get("included"), v.get("size")) for k, v in hf.items()})
        chk("neben dem Paket bleibt keine halbfertige Datei liegen", not Path(dest + ".part").exists())
        try:
            back = T.package_import_job(job(), dest)
            err = ""
        except Exception as e:  # noqa: BLE001
            back, err = {}, repr(e)
        mp = back.get("map") or {}
        chk("das Paket lässt sich wieder einlesen: beide Dateien liegen im Importordner, das eingebettete Bild steht weiter im Projekt",
            not err and set(mp) == {"m0", "m2"} and Path(mp["m0"]).read_bytes() == b"v" * 5000 and Path(mp["m2"]).read_bytes() == b"l" * 700
            and back["header"]["project"]["slides"][0]["img"] == inline and str(TMP / "heim") in mp["m0"], err or sorted(mp))
        # Auch kurze Angaben, die das System nicht als Pfad annimmt, führen zu keinem Abbruch

        def bad_resolve(self, strict=False):
            raise ValueError("stat: embedded null character in path")
        pathlib.Path.resolve = bad_resolve
        try:
            got = T.norm_path("C:/Videos/kaputt.mp4")
        except ValueError as e:
            got = f"Abbruch: {e}"
        chk("lässt sich eine Angabe nicht als Pfad auflösen, bleibt sie unverändert statt den Vorgang abzubrechen", got == "C:/Videos/kaputt.mp4", got)
    finally:
        pathlib.Path.resolve = real_resolve


def kleine_helfer():
    """2.27: Vorschaubild in der Projektliste; dauerhafte Textzeile im Export (Ecke, eigene Spur); SRT nur mit Untertiteln."""
    vid = T.norm_path(str(TMP / "videos" / "rede.mp4"))
    mk(Path(vid), b"x")
    T.save_project("h1", json.dumps({"id": "h1", "name": "Mit Video", "updated": 1, "sources": [{"uri": str(TMP / "ton.mp3"), "kind": "audio", "duration": 5}, {"uri": vid, "duration": 10}]}))
    T.save_project("h2", json.dumps({"id": "h2", "name": "Nur Ton", "updated": 2, "sources": [{"uri": str(TMP / "ton.mp3"), "kind": "audio", "duration": 5}]}))
    T.save_project("h3", json.dumps({"id": "h3", "name": "Eingebettet", "updated": 3, "sources": [{"uri": "data:video/mp4;base64," + "A" * 5000, "duration": 5}]}))
    T.ALLOWED.discard(vid)
    T._list_cache.clear()
    lst = {p["id"]: p for p in T.list_projects()}
    chk("Projektliste nennt das erste Video als Quelle des Vorschaubilds; Ton und eingebettete Daten liefern keins",
        lst["h1"]["thumb"] == vid and lst["h2"]["thumb"] == "" and lst["h3"]["thumb"] == "", [lst[k]["thumb"][:40] for k in ("h1", "h2", "h3")])
    chk("das Video ist für das Vorschaubild freigegeben, ohne dass das Projekt geöffnet wurde", vid in T.ALLOWED)
    for k in ("h1", "h2", "h3"):
        T.delete_project(k)
        T.trash_purge(k)
    # Textzeile, Titel und Untertitel, wie sie die Oberfläche in den Exportplan schreibt
    raw = [{"start": 0, "end": 10, "text": "@kanal · V. i. S. d. P.", "x": 0.8, "y": 0.09, "size": 0.028, "title": True, "line": True, "anchor": "or", "mx": 0.06, "my": 0.08, "bg": True, "outline": False, "font": ""},
           {"start": 1, "end": 3, "text": "Ein Titel", "x": 0.5, "y": 0.3, "size": 0.075, "title": True, "font": ""},
           {"start": 1.5, "end": 2.5, "text": "gesprochen"},
           {"start": 0, "end": 10, "text": "unten links", "x": 0.2, "y": 0.9, "size": 0.028, "title": True, "line": True, "anchor": "ul", "mx": 0.035, "my": 0.02, "font": ""},
           {"start": 0, "end": 10, "text": "unten Mitte", "x": 0.5, "y": 0.9, "size": 0.028, "title": True, "line": True, "anchor": "um", "mx": 0.035, "my": 0.02, "font": ""},
           {"start": 0, "end": 10, "text": "kaputt", "title": True, "line": True, "anchor": "xy", "mx": "?"}]
    cues = T.clean_cues(raw)
    by = {c["text"]: c for c in cues}
    chk("Textzeile: Ecke und Randabstand kommen im Export an, unbrauchbare Angaben werden verworfen",
        by["@kanal · V. i. S. d. P."].get("line") is True and by["@kanal · V. i. S. d. P."]["anchor"] == "or" and by["@kanal · V. i. S. d. P."]["mx"] == 0.06 and by["@kanal · V. i. S. d. P."]["my"] == 0.08
        and by["kaputt"].get("line") is True and "anchor" not in by["kaputt"] and "line" not in by["gesprochen"] and "anchor" not in by["Ein Titel"])
    chk("als Untertitel gilt nur Gesprochenes – Titel und Textzeile gehören zum Bild", [c["text"] for c in T.spoken_cues(cues)] == ["gesprochen"])
    srt = TMP / "helfer.srt"
    T.write_srt(T.spoken_cues(cues), srt)
    chk("die SRT-Datei enthält nur die Untertitel", srt.read_text(encoding="utf-8").strip().split("\n") == ["1", "00:00:01,500 --> 00:00:02,500", "gesprochen"], srt.read_text(encoding="utf-8")[:80].replace("\n", " | "))
    ass = TMP / "helfer.ass"
    T.write_ass(cues, {"size": "mittel"}, ass, 1080, 1920, {})
    ev = {ln.split("}", 1)[1]: ln for ln in ass.read_text(encoding="utf-8-sig").splitlines() if ln.startswith("Dialogue:")}
    pad = max(2.0, 0.028 * 1080 * 1.25 / 6)   # Rand des Kastens
    chk("eingebrannt sitzt die Textzeile an ihrer Ecke: oben rechts mit Kasten um dessen Rand nach innen",
        f"\\an9\\pos({1080 - 0.06 * 1080 - pad:.0f},{0.08 * 1920 + pad:.0f})" in ev["@kanal · V. i. S. d. P."] and ",Box,," in ev["@kanal · V. i. S. d. P."], ev["@kanal · V. i. S. d. P."][:110])
    chk("unten links und unten in der Mitte", f"\\an1\\pos({0.035 * 1080:.0f},{1920 - 0.02 * 1920:.0f})" in ev["unten links"] and f"\\an2\\pos(540,{1920 - 0.02 * 1920:.0f})" in ev["unten Mitte"],
        [ev["unten links"][:90], ev["unten Mitte"][:90]])
    chk("Titel und Untertitel bleiben über ihren Mittelpunkt gesetzt", "\\an5\\pos(540,576)" in ev["Ein Titel"] and "\\an5\\pos(" in ev["gesprochen"] and "\\an5" in ev["kaputt"])
    # Concat: die Textzeile bekommt ihre eigene Spur, die SRT-Datei daneben enthält nur die Untertitel
    probe0, root0 = T.probe, T.concat_root
    T.probe = lambda p: {"duration": 10.0, "hasVideo": True, "hasAudio": True, "width": 1080, "height": 1920, "fps": 30.0}
    T.concat_root = lambda: TMP / "Concat"
    try:
        folder = T.write_concat({"width": 1080, "height": 1920, "fps": 30, "segments": [{"uri": vid, "in": 0, "out": 10, "kind": "main"}], "overlays": []}, "helfer", cues, {"size": "mittel"})
    finally:
        T.probe, T.concat_root = probe0, root0
    doc = json.loads((folder / "concat.json").read_text(encoding="utf-8"))
    tracks = {c["text"]["content"]: c["trackId"] for c in doc["clips"] if c["kind"] == "text"}
    chk("Concat: Textzeilen liegen auf T4, Titel und Untertitel auf T3", tracks == {"@kanal · V. i. S. d. P.": "T4", "unten links": "T4", "unten Mitte": "T4", "kaputt": "T4", "Ein Titel": "T3", "gesprochen": "T3"}, tracks)
    chk("Concat: die SRT-Datei daneben enthält nur die Untertitel", (folder / "helfer.srt").read_text(encoding="utf-8").count("-->") == 1)


def umzug():
    a = json.loads((TMP / "umzug.json").read_text())
    mk(T.FONT_DIR / "Zweite.otf", b"ANDERE-SCHRIFT")      # gleicher Name, anderer Inhalt
    r = T.backup_restore_job(job(), ZIP)
    chk("anderer Rechner: alle Projekte, Bilder und Schriften kommen dazu", sorted(r["added"]) == ["Interview", "Kurzclip", "Rede zum Haushalt"] and r["slides"] == 3 and r["fonts"] == 2 and not r["failed"])
    p1 = proj("b1")
    f1n = T.norm_path(str(T.FONT_DIR / "Meine Schrift.ttf"))
    chk("Bildpfade zeigen in den neuen Datenordner, die Dateien liegen dort", p1["items"][0]["clip"]["uri"] == T.norm_path(str(D / "folien/b1/folie-a1-2.png"))
        and Path(p1["items"][0]["clip"]["uri"]).read_bytes() == b"\x89PNG-1" * 1000 and Path(p1["slides"][0]["img"]).is_file() and Path(p1["items"][1]["clip"]["uri"]).is_file())
    chk("Schriftschlüssel folgen dem neuen Speicherort", p1["sub_style"]["font"] == "u" + T._js_hash(f1n) != a["key1"] and p1["items"][0]["font"] == "u" + T._js_hash(f1n))
    chk("auch in den gesicherten Looks zeigt die Schrift auf den neuen Speicherort", r["prefs"]["hc-sub-looks"][0]["st"]["font"] == "u" + T._js_hash(f1n) and r["prefs"]["hc-fillers"] == ["halt", "ich sag mal"], r["prefs"].get("hc-sub-looks"))
    chk("Videopfade und Transkript bleiben, wie sie waren", p1["sources"][0]["uri"] == "/videos/rede.mp4" and p1["tokens"][0]["text"] == "u1abc" and proj("b2")["sources"][0]["orig"] == "/videos/interview.mp4")
    chk("vorhandene Schrift gleichen Namens bleibt, die gesicherte liegt daneben", (T.FONT_DIR / "Zweite.otf").read_bytes() == b"ANDERE-SCHRIFT" and (T.FONT_DIR / "Zweite_2.otf").read_bytes() == b"FONT-B" * 50)


def neue_versionen():
    hits = []
    state = {"fail": False}
    site = "https://github.com/honeybalecta/textschnitt/releases/"

    def rel(v, **kw):
        return {"tag_name": "v" + v, "html_url": f"{site}tag/v{v}", "published_at": "2026-12-01T10:00:00Z",
                "assets": [{"name": f"HoneyCut-Setup-{v}.exe", "browser_download_url": f"{site}download/v{v}/HoneyCut-Setup-{v}.exe", "size": 640000000}], **kw}
    releases = [{"tag_name": "android-v9.9.9", "assets": [{"name": "x.apk", "browser_download_url": site + "x.apk", "size": 5}]}, rel("2.99.0", draft=True),
                {"tag_name": "v2.98.0", "assets": []}, rel("2.28.0"), rel("2.27.0"), rel("2.25.0")]
    notes = ("# Neuigkeiten\n\nWas sich mit jeder Version ändert.\n\n## 2.29.0 · Noch nicht veröffentlicht\n- kommt später\n\n## 2.28.0 · Quellen und Belege\n"
             "- Quellen zu Aussagen hinterlegen\n- Bauchbinden im Hausstil\n\n## 2.27.0 – Kleine Helfer\n- Titelbild exportieren\n* Kapitelmarken\n\n## 2.25.0 · Grundüberholung\n- flüssigere Zeitleiste\n")

    def get(url, timeout=8.0):
        hits.append(url)
        if state["fail"]:
            raise OSError("nicht erreichbar")
        return (json.dumps(releases) if "releases" in url else notes).encode("utf-8")
    T._http_get = get
    chk("Versionen werden als Zahlen verglichen", T._ver("v2.26.0") == (2, 26, 0) and T._ver("2.26") == (2, 26, 0) and T._ver("android-v2.26.0") == () and T._ver("2.10.0") > T._ver("2.9.9"))
    real = T.VERSION
    T.VERSION = "2.26.0"
    st = T.update_state()
    chk("Ausgangslage: eingeschaltet, noch nichts bekannt", st["supported"] and st["enabled"] and st["latest"] is None and st["checked"] == 0)
    L = T.update_check()["latest"]
    chk("die neueste veröffentlichte Windows-Fassung wird gefunden (Entwurf, Android und Fassung ohne Installer zählen nicht)",
        bool(L) and L["version"] == "2.28.0" and L["installer"].endswith("HoneyCut-Setup-2.28.0.exe") and L["size"] == 640000000, L and L["version"])
    chk("Stichpunkte aller übersprungenen Versionen, neueste zuerst", [n["version"] for n in L["notes"]] == ["2.28.0", "2.27.0"] and L["notes"][0]["title"] == "Quellen und Belege"
        and L["notes"][0]["points"] == ["Quellen zu Aussagen hinterlegen", "Bauchbinden im Hausstil"] and L["notes"][1]["points"] == ["Titelbild exportieren", "Kapitelmarken"])
    chk("genau zwei Abfragen: Veröffentlichungen und Neuigkeiten", len(hits) == 2 and "releases" in hits[0] and hits[1].endswith("NEUIGKEITEN.md"), hits)
    T.update_check()
    chk("am selben Tag wird nicht noch einmal gefragt", len(hits) == 2)
    saved = json.loads(T.SETTINGS_PATH.read_text(encoding="utf-8"))
    chk("das Ergebnis bleibt über Neustarts erhalten", saved["updateLatest"]["version"] == "2.28.0" and saved["updateChecked"] > time.time() - 60)
    T.settings_set(updates=False, updateChecked=0)
    T.update_check()
    chk("abgeschaltet: keine Abfrage", len(hits) == 2 and T.update_state()["enabled"] is False)
    T.update_check(force=True)
    chk("„Jetzt prüfen“ fragt trotzdem nach", len(hits) == 4)
    T.VERSION = "2.28.0"
    chk("nach dem Installieren verschwindet der Hinweis", T.update_state()["latest"] is None)
    T.settings_set(updates=True, updateChecked=0)
    chk("aktuell: kein Hinweis", T.update_check()["latest"] is None)
    T.VERSION = "2.26.0"
    state["fail"] = True
    T.settings_set(updateChecked=0)
    try:
        T.update_check()
        chk("GitHub nicht erreichbar: Fehler für den Aufrufer", False)
    except OSError:
        chk("GitHub nicht erreichbar: Fehler für den Aufrufer, nichts wird als geprüft vermerkt", T.settings_get().get("updateChecked") == 0)
    state["fail"] = False
    T.update_check(force=True)
    opened = []
    T.webbrowser.open = lambda u, *a, **k: opened.append(u)
    T.update_open("installer")
    T.update_open("page")
    chk("Installer und Seite öffnen sich im Browser", opened == [site + "download/v2.28.0/HoneyCut-Setup-2.28.0.exe", site + "tag/v2.28.0"])
    T.settings_set(updateLatest={**T.settings_get()["updateLatest"], "installer": "https://boese.example/x.exe"})
    try:
        T.update_open("installer")
        chk("fremde Adresse wird nicht geöffnet", False)
    except ValueError:
        chk("fremde Adresse wird nicht geöffnet", len(opened) == 2)
    T.VERSION = real


def bericht_und_protokoll():
    logged = []
    T.log = lambda msg: logged.append(msg)
    with open(T.LOG_PATH, "ab") as f:
        f.write(("x" * 99 + "\n").encode() * 60000)
    before = T.LOG_PATH.stat().st_size
    cut = T.trim_log()
    after = T.LOG_PATH.stat().st_size
    chk("Protokoll über 5 MB wird auf die letzten 2 MB gekürzt, an einer Zeilengrenze", before > 5e6 and 1.9e6 < after <= 2e6 and cut == before - after and T.LOG_PATH.read_bytes()[:1] == b"x")
    with open(T.LOG_PATH, "a", encoding="utf-8") as f:
        f.write("2026-11-15 12:00:00  Testzeile für den Bericht äöü\n")
    txt = T.report_text({"Fenster": "1480×900", "Browser-Kennung": "Test/1.0"})
    want = [f"Version: {T.VERSION}", "Betriebssystem:", "Prozessor:", "ffmpeg:", f"Datenordner: {D}", "Projektdateien:", "Fenster: 1480×900", "── Protokoll", "Testzeile für den Bericht äöü"]
    chk("Fehlerbericht enthält Version, System, Speicher, Angaben der Oberfläche und das Protokoll", all(x in txt for x in want), [x for x in want if x not in txt])
    chk("der Bericht bleibt handlich (höchstens die letzten 400 KB des Protokolls)", len(txt.encode("utf-8")) < 450_000, len(txt))


if MODE == "umzug":
    umzug()
    sys.exit(1 if BAD else 0)
for part in (speichern_und_fassungen, speicher, sicherung, projektpakete, kleine_helfer, neue_versionen, bericht_und_protokoll):
    print(f"── {part.__name__.replace('_', ' ')} ──", flush=True)
    part()
print(f"ERGEBNIS Backend ohne Browser: {N} geprüft, {BAD} Fehler")
sys.exit(1 if BAD else 0)
