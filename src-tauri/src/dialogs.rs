use super::*;

#[cfg(feature = "test-harness")]
static CONFIG: std::sync::OnceLock<Mutex<Value>> = std::sync::OnceLock::new();
#[cfg(feature = "test-harness")]
pub fn configure(value: Value) -> Result<Value> {
    let root =
        std::env::var("FOLIO_TEST_ROOT").map_err(|_| "Test harness requires an isolated root")?;
    for key in ["open", "save", "export"] {
        if let Some(path) = value[key].as_str() {
            let parent = files::canonical(Path::new(path).parent().ok_or("Missing parent")?)?;
            if !parent.starts_with(files::canonical(Path::new(&root))?) {
                return Err("Test paths must stay inside the isolated root.".into());
            }
        }
    }
    *CONFIG.get_or_init(|| Mutex::new(json!({}))).lock().unwrap() = value;
    Ok(json!(true))
}
#[cfg(feature = "test-harness")]
fn configured(key: &str) -> Option<Value> {
    if std::env::var_os("FOLIO_TEST_ROOT").is_some() {
        Some(CONFIG.get_or_init(|| Mutex::new(json!({}))).lock().unwrap()[key].clone())
    } else {
        None
    }
}
pub fn open_file() -> Option<PathBuf> {
    #[cfg(feature = "test-harness")]
    if let Some(v) = configured("open") {
        return v.as_str().map(PathBuf::from);
    }
    rfd::FileDialog::new()
        .set_title("Open a Markdown document")
        .add_filter("Markdown and text", files::EXTENSIONS)
        .pick_file()
}
pub fn save_file(name: &str) -> Option<PathBuf> {
    #[cfg(feature = "test-harness")]
    if let Some(v) = configured("save") {
        return v.as_str().map(PathBuf::from);
    }
    rfd::FileDialog::new()
        .set_title("Save Markdown as")
        .set_file_name(name)
        .add_filter("Markdown and text", files::EXTENSIONS)
        .save_file()
}
pub fn export_file(name: &str, extension: &str) -> Option<PathBuf> {
    #[cfg(feature = "test-harness")]
    if let Some(v) = configured("export") {
        return v.as_str().map(PathBuf::from);
    }
    rfd::FileDialog::new()
        .set_title("Export document")
        .set_file_name(name)
        .add_filter("Document", &[extension])
        .save_file()
}
pub fn choice(conflict: bool) -> String {
    #[cfg(feature = "test-harness")]
    if let Some(v) = configured("choice") {
        return v.as_str().unwrap_or("Cancel").into();
    }
    let (title, description, yes, no) = if conflict {
        (
            "File changed on disk",
            "Your edits are kept. Save a separate copy, replace the disk version, or cancel.",
            "Save a copy",
            "Replace disk version",
        )
    } else {
        (
            "Unsaved changes",
            "Save your changes before leaving this document?",
            "Save",
            "Discard",
        )
    };
    match rfd::MessageDialog::new()
        .set_title(title)
        .set_description(description)
        .set_level(rfd::MessageLevel::Warning)
        .set_buttons(rfd::MessageButtons::YesNoCancelCustom(
            yes.into(),
            no.into(),
            "Cancel".into(),
        ))
        .show()
    {
        rfd::MessageDialogResult::Custom(label) => label,
        _ => "Cancel".into(),
    }
}
