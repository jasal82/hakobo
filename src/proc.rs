// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

//! Hilfen für Unterprozesse.

use std::process::Command;

/// Unterprozesse unter Windows ohne aufblitzendes Konsolenfenster starten.
pub trait NoWindow {
    fn no_window(&mut self) -> &mut Self;
}

impl NoWindow for Command {
    fn no_window(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            self.creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        }
        #[cfg(not(windows))]
        {
            self
        }
    }
}
