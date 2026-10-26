// Bettet unter Windows Programmsymbol, Versionsinformationen und das
// Anwendungsmanifest (DPI-Bewusstsein, moderne Steuerelemente) in die EXE ein.

fn main() {
    println!("cargo:rerun-if-changed=assets/icon/sqizzo.ico");
    println!("cargo:rerun-if-changed=assets/icon/sqizzo.manifest");
    println!("cargo:rerun-if-changed=build.rs");

    #[cfg(windows)]
    {
        let mut res = winresource::WindowsResource::new();
        res.set_icon("assets/icon/sqizzo.ico");
        res.set_manifest_file("assets/icon/sqizzo.manifest");
        res.set("ProductName", "Sqizzo");
        res.set("FileDescription", "Sqizzo – Notizen, Todos und Termine als Outline");
        res.set("InternalName", "sqizzo");
        res.set("OriginalFilename", "sqizzo.exe");
        res.set("CompanyName", "Sqizzo");
        res.set("LegalCopyright", "© 2026 Johannes Asal");
        if let Err(e) = res.compile() {
            println!("cargo:warning=Windows-Ressourcen konnten nicht eingebettet werden: {e}");
        }
    }
}
