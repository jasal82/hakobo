// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

// Bettet unter Windows Programmsymbol, Versionsinformationen und das
// Anwendungsmanifest (DPI-Bewusstsein, moderne Steuerelemente) in die EXE ein.

fn main() {
    println!("cargo:rerun-if-changed=assets/icon/hakobo.ico");
    println!("cargo:rerun-if-changed=assets/icon/hakobo.manifest");
    println!("cargo:rerun-if-changed=build.rs");

    #[cfg(windows)]
    {
        let mut res = winresource::WindowsResource::new();
        res.set_icon("assets/icon/hakobo.ico");
        res.set_manifest_file("assets/icon/hakobo.manifest");
        res.set("ProductName", "Hakobo");
        res.set("FileDescription", "Hakobo – Notizen, Todos und Termine als Outline");
        res.set("InternalName", "hakobo");
        res.set("OriginalFilename", "hakobo.exe");
        res.set("CompanyName", "Hakobo");
        res.set("LegalCopyright", "© 2026 Johannes Asal");
        if let Err(e) = res.compile() {
            println!("cargo:warning=Windows-Ressourcen konnten nicht eingebettet werden: {e}");
        }
    }
}
