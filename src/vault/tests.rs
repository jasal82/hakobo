use super::*;
use chrono::Datelike;

fn write(dir: &Path, rel: &str, text: &str) {
    let p = dir.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, text).unwrap();
}

fn read(dir: &Path, rel: &str) -> String {
    std::fs::read_to_string(dir.join(rel)).unwrap().replace("\r\n", "\n")
}

fn page<'a>(v: &'a Vault, path: &str) -> &'a Node {
    v.page_by_path(path).unwrap_or_else(|| panic!("Seite {path} fehlt"))
}

fn child_texts(v: &Vault, id: &str) -> Vec<String> {
    v.get(id).unwrap().children.iter().map(|c| v.get(c).unwrap().text.clone()).collect()
}

#[test]
fn opens_empty_vault_with_virtual_inbox_and_types() {
    let tmp = tempfile::tempdir().unwrap();
    let v = Vault::open(tmp.path()).unwrap();
    let inbox = v.get(&v.inbox).unwrap();
    assert_eq!(inbox.text, "Inbox");
    assert!(!inbox.page.as_ref().unwrap().has_file);
    assert!(tmp.path().join(".sqizzo/types.toml").exists());
    assert!(v.types.types.contains_key("meeting"));
    assert_eq!(v.get(ROOT).unwrap().children, vec![v.inbox.clone()]);
}

#[test]
fn loads_page_tree_from_folders() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "Projekte.md", "- Übersicht\n");
    write(tmp.path(), "Projekte/Sqonto.md", "- Milestone 1 #projekte/sqonto/milestone1\n");
    write(tmp.path(), "Projekte/Sqritto.md", "");
    write(tmp.path(), "Personen/Anna.md", "---\ntags: [person]\nemail: anna@example.com\n---\n");
    write(tmp.path(), "assets/bild.md", "- kein Seite");
    write(tmp.path(), ".hidden/x.md", "- versteckt");
    let v = Vault::open(tmp.path()).unwrap();
    let root = child_texts(&v, ROOT);
    assert_eq!(root, vec!["Inbox", "Personen", "Projekte"]);
    let projekte = page(&v, "Projekte");
    assert_eq!(child_texts(&v, &projekte.id), vec!["Übersicht", "Sqonto", "Sqritto"]);
    let personen = page(&v, "Personen");
    assert!(!personen.page.as_ref().unwrap().has_file);
    let anna = page(&v, "Personen/Anna");
    assert_eq!(anna.field("email"), Some("anna@example.com"));
    assert_eq!(v.tags_of(anna), vec!["person"]);
    let ms = &v.get(&page(&v, "Projekte/Sqonto").children[0]).unwrap();
    assert!(v.has_tag(ms, "projekte"));
    assert!(v.has_tag(ms, "projekte/sqonto"));
    assert!(!v.has_tag(ms, "projekt"));
}

#[test]
fn creates_items_and_writes_inbox() {
    let tmp = tempfile::tempdir().unwrap();
    let mut v = Vault::open(tmp.path()).unwrap();
    let inbox = v.inbox.clone();
    v.apply(vec![
        Op::Create { id: Some("aaaaaa".into()), parent: inbox.clone(), index: None, text: "Idee".into(), body: String::new(), fields: vec![], task: None, page: false },
        Op::Create {
            id: Some("bbbbbb".into()),
            parent: inbox.clone(),
            index: Some(0),
            text: "Bericht".into(),
            body: "Notiz".into(),
            fields: vec![Field { key: "date".into(), value: "2026-10-30".into() }],
            task: Some(Task::Open),
            page: false,
        },
        Op::Create { id: Some("cccccc".into()), parent: "aaaaaa".into(), index: None, text: "Detail".into(), body: String::new(), fields: vec![], task: None, page: false },
    ])
    .unwrap();
    v.flush().unwrap();
    assert_eq!(read(tmp.path(), "Inbox.md"), "- [ ] Bericht\n  date:: 2026-10-30\n  Notiz\n- Idee\n  - Detail\n");
}

#[test]
fn rejects_items_at_root_and_cycles() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "A.md", "- x\n  - y\n");
    let mut v = Vault::open(tmp.path()).unwrap();
    let a = page(&v, "A").id.clone();
    let x = v.get(&a).unwrap().children[0].clone();
    let y = v.get(&x).unwrap().children[0].clone();
    assert!(v.apply(vec![Op::Create { id: None, parent: ROOT.into(), index: None, text: "t".into(), body: String::new(), fields: vec![], task: None, page: false }]).is_err());
    assert!(v.apply(vec![Op::Move { id: x.clone(), parent: y, index: None }]).is_err());
    assert!(v.apply(vec![Op::Move { id: x, parent: ROOT.into(), index: None }]).is_err());
}

#[test]
fn moves_items_between_pages_and_updates_links() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "Inbox.md", "- Idee ^idee01\n");
    write(tmp.path(), "Projekte.md", "- Ideen\n");
    write(tmp.path(), "Notizen.md", "- siehe [[Inbox#^idee01|Idee]]\n");
    let mut v = Vault::open(tmp.path()).unwrap();
    let ideen = page(&v, "Projekte").children[0].clone();
    v.apply(vec![Op::Move { id: "idee01".into(), parent: ideen.clone(), index: None }]).unwrap();
    v.flush().unwrap();
    assert_eq!(read(tmp.path(), "Inbox.md"), "");
    assert_eq!(read(tmp.path(), "Projekte.md"), "- Ideen\n  - Idee ^idee01\n");
    assert_eq!(read(tmp.path(), "Notizen.md"), "- siehe [[Projekte#^idee01|Idee]]\n");
}

#[test]
fn renames_page_and_rewrites_links() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "Projekte.md", "- a\n");
    write(tmp.path(), "Projekte/Sqonto.md", "- b ^bbbbbb\n");
    write(tmp.path(), "Log.md", "- [[Projekte]] und [[Sqonto]] und [[Projekte/Sqonto#^bbbbbb|b]]\n  projekt:: [[Projekte]]\n");
    let mut v = Vault::open(tmp.path()).unwrap();
    let id = page(&v, "Projekte").id.clone();
    v.apply(vec![Op::Update { id: id.clone(), text: Some("Vorhaben".into()), body: None, task: None, fields: None }]).unwrap();
    v.flush().unwrap();
    assert!(tmp.path().join("Vorhaben.md").exists());
    assert!(tmp.path().join("Vorhaben/Sqonto.md").exists());
    assert!(!tmp.path().join("Projekte.md").exists());
    assert_eq!(page(&v, "Vorhaben/Sqonto").text, "Sqonto");
    assert_eq!(read(tmp.path(), "Log.md"), "- [[Vorhaben]] und [[Sqonto]] und [[Sqonto#^bbbbbb|b]]\n  projekt:: [[Vorhaben]]\n");
    // ID der Seite bleibt erhalten
    assert_eq!(v.get(&id).unwrap().page.as_ref().unwrap().path, "Vorhaben");
}

#[test]
fn moves_page_into_other_page() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "Archiv.md", "");
    write(tmp.path(), "Alt.md", "- x\n");
    write(tmp.path(), "Alt/Unter.md", "- y\n");
    let mut v = Vault::open(tmp.path()).unwrap();
    let alt = page(&v, "Alt").id.clone();
    let archiv = page(&v, "Archiv").id.clone();
    v.apply(vec![Op::Move { id: alt.clone(), parent: archiv.clone(), index: None }]).unwrap();
    assert!(tmp.path().join("Archiv/Alt.md").exists());
    assert!(tmp.path().join("Archiv/Alt/Unter.md").exists());
    assert_eq!(child_texts(&v, &archiv), vec!["Alt"]);
    assert_eq!(page(&v, "Archiv/Alt/Unter").text, "Unter");
}

#[test]
fn creating_link_pins_target_id() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "A.md", "- Ziel\n");
    let mut v = Vault::open(tmp.path()).unwrap();
    let target = page(&v, "A").children[0].clone();
    let link = v.link_to(&target).unwrap();
    assert_eq!(link, format!("[[A#^{target}|Ziel]]"));
    let inbox = v.inbox.clone();
    v.apply(vec![Op::Create { id: None, parent: inbox, index: None, text: format!("siehe {link}"), body: String::new(), fields: vec![], task: None, page: false }]).unwrap();
    v.flush().unwrap();
    assert_eq!(read(tmp.path(), "A.md"), format!("- Ziel ^{target}\n"));
    let n = v.get(&page(&v, "Inbox").children[0]).unwrap();
    let dto = v.dto(&n.id).unwrap();
    assert_eq!(dto.links[0].id.as_deref(), Some(target.as_str()));
}

#[test]
fn alias_is_refreshed_on_write() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "A.md", "- Neuer Titel ^zzzzzz\n- [[A#^zzzzzz|Alter Titel]]\n");
    let mut v = Vault::open(tmp.path()).unwrap();
    let a = page(&v, "A").id.clone();
    v.apply(vec![Op::Update { id: a, text: None, body: Some("Notiz".into()), task: None, fields: None }]).unwrap();
    v.flush().unwrap();
    assert_eq!(read(tmp.path(), "A.md"), "Notiz\n\n- Neuer Titel ^zzzzzz\n- [[A#^zzzzzz|Neuer Titel]]\n");
}

#[test]
fn ids_are_stable_across_reopen_and_external_edits() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "A.md", "- eins\n  - unter\n- zwei\n- zwei\n");
    let v1 = Vault::open(tmp.path()).unwrap();
    let ids1 = page(&v1, "A").children.clone();
    let v2 = Vault::open(tmp.path()).unwrap();
    assert_eq!(page(&v2, "A").children, ids1);
    assert_ne!(ids1[1], ids1[2]);

    // Externe Änderung: Knoten vorne einfügen, „zwei“ ändern
    let mut v = v2;
    let unter = v.get(&ids1[0]).unwrap().children[0].clone();
    write(tmp.path(), "A.md", "- neu\n- eins\n  - unter\n- zwei!\n- zwei\n");
    assert!(v.reload_from_disk().unwrap());
    let ids = page(&v, "A").children.clone();
    assert_eq!(ids.len(), 4);
    assert_eq!(ids[1], ids1[0], "„eins“ behält seine ID");
    assert_eq!(v.get(&ids[1]).unwrap().children[0], unter);
    assert!(ids.contains(&ids1[1]) || ids.contains(&ids1[2]));
    // Unveränderte Datei → keine Änderung
    assert!(!v.reload_from_disk().unwrap());
}

#[test]
fn dirty_pages_win_over_disk_until_flushed() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "A.md", "- eins\n");
    let mut v = Vault::open(tmp.path()).unwrap();
    let a = page(&v, "A").id.clone();
    v.apply(vec![Op::Create { id: None, parent: a, index: None, text: "intern".into(), body: String::new(), fields: vec![], task: None, page: false }]).unwrap();
    write(tmp.path(), "A.md", "- extern\n");
    v.reload_from_disk().unwrap();
    v.flush().unwrap();
    assert_eq!(read(tmp.path(), "A.md"), "- eins\n- intern\n");
}

#[test]
fn external_delete_and_create() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "A.md", "- a\n");
    let mut v = Vault::open(tmp.path()).unwrap();
    std::fs::remove_file(tmp.path().join("A.md")).unwrap();
    write(tmp.path(), "B/C.md", "- c\n");
    assert!(v.reload_from_disk().unwrap());
    assert!(v.page_by_path("A").is_none());
    let b = page(&v, "B");
    assert!(!b.page.as_ref().unwrap().has_file);
    assert_eq!(child_texts(&v, &b.id.clone()), vec!["C"]);
}

#[test]
fn completing_tasks() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "A.md", "- [ ] einmal\n- [ ] Müll rausbringen\n  date:: 2026-10-26\n  repeat:: weekly\n");
    let mut v = Vault::open(tmp.path()).unwrap();
    let kids = page(&v, "A").children.clone();
    v.apply(vec![
        Op::Update { id: kids[0].clone(), text: None, body: None, task: Some(Some(Task::Done)), fields: None },
        Op::Update { id: kids[1].clone(), text: None, body: None, task: Some(Some(Task::Done)), fields: None },
    ])
    .unwrap();
    let once = v.get(&kids[0]).unwrap();
    assert_eq!(once.task, Some(Task::Done));
    assert!(once.field("done").is_some());
    let rec = v.get(&kids[1]).unwrap();
    assert_eq!(rec.task, Some(Task::Open));
    let next = When::parse(rec.field("date").unwrap()).unwrap().start;
    assert!(next > chrono::NaiveDate::from_ymd_opt(2026, 10, 26).unwrap());
    assert_eq!(next.weekday(), chrono::Weekday::Mon);
    // Wieder öffnen entfernt `done`
    v.apply(vec![Op::Update { id: kids[0].clone(), text: None, body: None, task: Some(Some(Task::Open)), fields: None }]).unwrap();
    assert!(v.get(&kids[0]).unwrap().field("done").is_none());
}

#[test]
fn page_fields_keep_frontmatter_formatting() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "P.md", "---\n# Kommentar\ntags:\n  - person\nemail: a@b.de\n---\n- x\n");
    let mut v = Vault::open(tmp.path()).unwrap();
    let p = page(&v, "P").clone();
    let mut fields = p.fields.clone();
    fields.push(Field { key: "firma".into(), value: "ACME".into() });
    v.apply(vec![Op::Update { id: p.id.clone(), text: None, body: None, task: None, fields: Some(fields) }]).unwrap();
    v.flush().unwrap();
    assert_eq!(read(tmp.path(), "P.md"), "---\n# Kommentar\ntags:\n  - person\nemail: a@b.de\nfirma: ACME\n---\n\n- x\n");
}

#[test]
fn creates_pages_with_unique_titles() {
    let tmp = tempfile::tempdir().unwrap();
    let mut v = Vault::open(tmp.path()).unwrap();
    let mut ch = Changes::default();
    let a = v.create_page(ROOT, "Ideen", None, &mut ch).unwrap();
    let b = v.create_page(ROOT, "ideen", None, &mut ch).unwrap();
    let c = v.create_page(&a, "Was: ist/das?", Some("pagexx".into()), &mut ch).unwrap();
    assert_eq!(c, "pagexx");
    assert_eq!(v.get(&b).unwrap().text, "ideen 2");
    assert_eq!(v.get(&c).unwrap().page.as_ref().unwrap().path, "Ideen/Was- ist-das-");
    assert!(tmp.path().join("Ideen/Was- ist-das-.md").exists());
}

#[test]
fn deletes_pages_and_items() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "A.md", "- x\n  - y\n- z\n");
    write(tmp.path(), "A/B.md", "- b\n");
    let mut v = Vault::open(tmp.path()).unwrap();
    let a = page(&v, "A").id.clone();
    let x = v.get(&a).unwrap().children[0].clone();
    let ch = v.apply(vec![Op::Delete { id: x.clone() }]).unwrap();
    assert_eq!(ch.removed.len(), 2);
    v.flush().unwrap();
    assert_eq!(read(tmp.path(), "A.md"), "- z\n");
    v.apply(vec![Op::Delete { id: a.clone() }]).unwrap();
    assert!(!tmp.path().join("A.md").exists());
    assert!(!tmp.path().join("A").exists());
    assert!(v.page_by_path("A/B").is_none());
    assert!(v.apply(vec![Op::Delete { id: v.inbox.clone() }]).is_err());
}

#[test]
fn natural_sorting() {
    assert_eq!(natural_cmp("Seite 2", "Seite 10"), Ordering::Less);
    assert_eq!(natural_cmp("a", "B"), Ordering::Less);
    assert_eq!(natural_cmp("x01", "x1"), Ordering::Equal);
}

#[test]
fn sanitizes_titles() {
    assert_eq!(sanitize_title("  a/b:c  "), "a-b-c");
    assert_eq!(sanitize_title("CON"), "CON_");
    assert_eq!(sanitize_title("..."), "Unbenannt");
    assert_eq!(sanitize_title("Ende."), "Ende");
}

#[test]
fn search_docs_have_paths_and_tags() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "Projekte/Sqonto.md", "- **Milestone** 1 #Projekte/Sqonto/M1\n  Notiz mit [[Link|Text]]\n");
    let mut v = Vault::open(tmp.path()).unwrap();
    let docs = v.search_docs();
    let d = docs.iter().find(|d| d.title.starts_with("Milestone")).unwrap();
    assert_eq!(d.path, vec!["Projekte", "Sqonto"]);
    assert_eq!(d.tags, vec!["projekte/sqonto/m1"]);
    assert_eq!(d.body, "Notiz mit Text");
}

#[test]
fn obsidian_tasks_due_date_is_recognized() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "A.md", "- [ ] Aufgabe 📅 2026-10-30\n- [ ] Ohne\n");
    let v = Vault::open(tmp.path()).unwrap();
    let a = page(&v, "A");
    let first = v.get(&a.children[0]).unwrap();
    assert_eq!(first.when().unwrap().start, chrono::NaiveDate::from_ymd_opt(2026, 10, 30).unwrap());
    assert!(v.get(&a.children[1]).unwrap().when().is_none());
}

#[test]
fn item_becomes_page() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "Projekte.md", "- Neues Projekt Alpha #projekt\n  status:: idee\n  Beschreibung.\n  - Schritt 1\n  - Schritt 2\n- danach\n");
    let mut v = Vault::open(tmp.path()).unwrap();
    let item = page(&v, "Projekte").children[0].clone();
    v.apply(vec![Op::ToPage { id: item.clone() }]).unwrap();
    v.flush().unwrap();
    assert_eq!(read(tmp.path(), "Projekte.md"), "- [[Neues Projekt Alpha]]\n- danach\n");
    assert_eq!(
        read(tmp.path(), "Projekte/Neues Projekt Alpha.md"),
        "---\ntags: [projekt]\nstatus: idee\n---\n\nBeschreibung.\n\n- Schritt 1\n- Schritt 2\n"
    );
    let p = page(&v, "Projekte/Neues Projekt Alpha");
    assert_eq!(v.tags_of(p), vec!["projekt"]);
    let dto = v.dto(&item).unwrap();
    assert_eq!(dto.links[0].id.as_deref(), Some(p.id.as_str()));
}
