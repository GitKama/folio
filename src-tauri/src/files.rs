use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

pub type Result<T> = std::result::Result<T, String>;
pub const MAX_DOCUMENT: usize = 12 * 1024 * 1024;
pub const EXTENSIONS: &[&str] = &[
    "md", "markdown", "mdown", "mkd", "mkdn", "mdx", "qmd", "rmd", "txt",
];

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub name: String,
    pub content: String,
    pub path: Option<PathBuf>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default = "utf8")]
    pub encoding: String,
    #[serde(default)]
    pub bom: bool,
    #[serde(default = "lf")]
    pub eol: String,
    #[serde(default)]
    pub revision: Option<String>,
    #[serde(default)]
    pub unsaved: bool,
}
fn utf8() -> String {
    "UTF-8".into()
}
fn lf() -> String {
    "\n".into()
}
pub fn normalize(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}
pub fn local(path: &Path) -> Result<()> {
    let s = path.to_string_lossy();
    if !path.is_absolute() || s.starts_with("\\\\") || s.starts_with("//") {
        return Err("Choose a document on a local drive.".into());
    }
    Ok(())
}
pub fn canonical(path: &Path) -> Result<PathBuf> {
    local(path)?;
    let real = fs::canonicalize(path).map_err(|e| e.to_string())?;
    let s = real.to_string_lossy();
    if s.starts_with("\\\\?\\UNC\\") {
        return Err("Network paths are not supported.".into());
    }
    Ok(PathBuf::from(s.strip_prefix("\\\\?\\").unwrap_or(&s)))
}
fn extension(path: &Path) -> String {
    path.extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_ascii_lowercase()
}
fn bounded(path: &Path, limit: usize) -> Result<Vec<u8>> {
    let stat = fs::metadata(path).map_err(|e| e.to_string())?;
    if !stat.is_file() || stat.len() > limit as u64 {
        return Err("File exceeds the supported size limit.".into());
    }
    let data = fs::read(path).map_err(|e| e.to_string())?;
    if data.len() > limit {
        return Err("File exceeds the supported size limit.".into());
    }
    Ok(data)
}
pub fn revision(path: &Path) -> Result<Option<String>> {
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(format!(
        "{:x}",
        Sha256::digest(bounded(path, MAX_DOCUMENT)?)
    )))
}
pub fn read(path: &Path) -> Result<Document> {
    let path = canonical(path)?;
    if !EXTENSIONS.contains(&extension(&path).as_str()) {
        return Err("Choose a Markdown or text file.".into());
    }
    let bytes = bounded(&path, MAX_DOCUMENT)?;
    let rev = Some(format!("{:x}", Sha256::digest(&bytes)));
    let bom = bytes.starts_with(&[0xef, 0xbb, 0xbf]);
    let (content, encoding) =
        if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
            if bytes.len() % 2 != 0 {
                return Err("This UTF-16 file is incomplete.".into());
            }
            let le = bytes[0] == 0xff;
            let words: Vec<u16> = bytes[2..]
                .as_chunks::<2>()
                .0
                .iter()
                .map(|p| {
                    if le {
                        u16::from_le_bytes([p[0], p[1]])
                    } else {
                        u16::from_be_bytes([p[0], p[1]])
                    }
                })
                .collect();
            (
                String::from_utf16(&words).map_err(|_| "Invalid UTF-16 text.")?,
                if le { "UTF-16 LE" } else { "UTF-16 BE" },
            )
        } else {
            match std::str::from_utf8(if bom { &bytes[3..] } else { &bytes }) {
                Ok(text) => (text.to_string(), "UTF-8"),
                Err(_) => (
                    encoding_rs::WINDOWS_1252.decode(&bytes).0.into_owned(),
                    "Windows-1252 (fallback)",
                ),
            }
        };
    if content.contains('\0') {
        return Err("This appears to be a binary file.".into());
    }
    let eol = content
        .find(['\r', '\n'])
        .map(|i| {
            if content[i..].starts_with("\r\n") {
                "\r\n"
            } else if content[i..].starts_with('\r') {
                "\r"
            } else {
                "\n"
            }
        })
        .unwrap_or("\n")
        .into();
    Ok(Document {
        name: path.file_name().unwrap().to_string_lossy().into(),
        content,
        path: Some(path),
        base_url: None,
        encoding: encoding.into(),
        bom,
        eol,
        revision: rev,
        unsaved: false,
    })
}
pub fn encode(content: &str, format: &Document) -> Result<Vec<u8>> {
    if content.contains('\0') {
        return Err("Invalid Markdown text.".into());
    }
    let text = if normalize(content) == normalize(&format.content) {
        format.content.clone()
    } else {
        normalize(content).replace('\n', &format.eol)
    };
    let mut bytes = Vec::new();
    match format.encoding.as_str() {
        "UTF-16 LE" | "UTF-16 BE" => {
            let le = format.encoding == "UTF-16 LE";
            bytes.extend(if le { [0xff, 0xfe] } else { [0xfe, 0xff] });
            for c in text.encode_utf16() {
                bytes.extend(if le { c.to_le_bytes() } else { c.to_be_bytes() });
            }
        }
        "Windows-1252 (fallback)" => {
            let (encoded, _, errors) = encoding_rs::WINDOWS_1252.encode(&text);
            if errors {
                return Err(
                    "This character cannot be saved as Windows-1252. Use Save As for a UTF-8 copy."
                        .into(),
                );
            }
            bytes.extend_from_slice(&encoded);
        }
        _ => {
            if format.bom {
                bytes.extend([0xef, 0xbb, 0xbf]);
            }
            bytes.extend(text.as_bytes());
        }
    }
    if bytes.len() > MAX_DOCUMENT {
        return Err("Document exceeds the 12 MB saving limit.".into());
    }
    Ok(bytes)
}
pub fn write(
    path: &Path,
    content: &str,
    format: &Document,
    expected: &Option<String>,
) -> Result<Document> {
    local(path)?;
    if !EXTENSIONS.contains(&extension(path).as_str()) {
        return Err("Choose a Markdown or text filename.".into());
    }
    let real = if path.exists() {
        canonical(path)?
    } else {
        canonical(path.parent().ok_or("Missing folder")?)?
            .join(path.file_name().ok_or("Missing filename")?)
    };
    let bytes = encode(content, format)?;
    if &revision(&real)? != expected {
        return Err(
            "The file changed on disk. Your edits are kept; save again to review the conflict."
                .into(),
        );
    }
    let mut temp =
        tempfile::NamedTempFile::new_in(real.parent().unwrap()).map_err(|e| e.to_string())?;
    temp.write_all(&bytes)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|e| e.to_string())?;
    if &revision(&real)? != expected {
        return Err("The file changed while saving. Your edits are kept.".into());
    }
    temp.persist(&real).map_err(|e| e.to_string())?;
    read(&real)
}
pub fn resolve(root: &Path, relative: &str) -> Result<PathBuf> {
    let relative = relative.replace('\\', "/");
    if relative.contains(':') || relative.starts_with("//") || relative.contains('\0') {
        return Err("Use a relative local path.".into());
    }
    let root = canonical(root)?;
    let real = canonical(&root.join(relative.trim_start_matches('/')))?;
    if !real.starts_with(&root) {
        return Err("This file is outside the document folder. Use Open document.".into());
    }
    Ok(real)
}
pub fn image(root: &Path, relative: &str) -> Result<(Vec<u8>, &'static str)> {
    let path = resolve(root, relative)?;
    let mime = match extension(&path).as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        _ => return Err("Only images can be embedded.".into()),
    };
    Ok((bounded(&path, 20 * 1024 * 1024)?, mime))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encodings_and_line_endings_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        for bytes in [
            b"\xef\xbb\xbf# Mixed\r\nline\nlast\r".to_vec(),
            vec![0xff, 0xfe, 65, 0, 13, 0, 10, 0],
            vec![0xfe, 0xff, 0, 65, 0, 10],
            vec![b'A', 0x80, b'\r', b'\n'],
        ] {
            fs::write(&path, &bytes).unwrap();
            let doc = read(&path).unwrap();
            assert_eq!(encode(&normalize(&doc.content), &doc).unwrap(), bytes);
        }
    }
    #[test]
    fn conflict_preserves_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        fs::write(&path, "old").unwrap();
        let doc = read(&path).unwrap();
        fs::write(&path, "external").unwrap();
        assert!(write(&path, "draft", &doc, &doc.revision).is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), "external");
    }
    #[test]
    fn atomic_save_and_encoding_errors() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        fs::write(&path, [0x80]).unwrap();
        let doc = read(&path).unwrap();
        assert!(write(&path, "🦀", &doc, &doc.revision).is_err());
        assert_eq!(fs::read(&path).unwrap(), vec![0x80]);
        assert_eq!(
            write(&path, "café", &doc, &doc.revision).unwrap().content,
            "café"
        );
    }
    #[test]
    fn path_escape_and_binary_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("docs");
        fs::create_dir(&root).unwrap();
        fs::write(dir.path().join("secret.png"), "private").unwrap();
        assert!(resolve(&root, "../secret.png").is_err());
        assert!(resolve(&root, "C:/secret.png").is_err());
        fs::write(root.join("binary.md"), [0, 1, 2]).unwrap();
        assert!(read(&root.join("binary.md")).is_err());
    }
    #[test]
    fn malformed_and_oversized_documents_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("input.md");
        fs::write(&path, [0xff, 0xfe, 65]).unwrap();
        assert!(read(&path).is_err());
        fs::write(&path, [0xff, 0xfe, 0, 0xd8]).unwrap();
        assert!(read(&path).is_err());
        fs::write(&path, vec![b'x'; MAX_DOCUMENT + 1]).unwrap();
        assert!(read(&path).is_err());
        assert!(local(Path::new("relative.md")).is_err());
        assert!(local(Path::new("\\\\server\\share\\note.md")).is_err());
    }
    #[test]
    fn edits_keep_crlf_and_utf8_bom() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("input.md");
        fs::write(&path, b"\xef\xbb\xbf# Old\r\nLine\r\n").unwrap();
        let doc = read(&path).unwrap();
        write(&path, "# New\nLine\nEnd", &doc, &doc.revision).unwrap();
        assert_eq!(
            fs::read(&path).unwrap(),
            b"\xef\xbb\xbf# New\r\nLine\r\nEnd"
        );
    }
}
