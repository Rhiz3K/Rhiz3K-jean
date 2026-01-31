//! NDJSON file tailing for real-time streaming
//!
//! This module provides functionality to tail an NDJSON file and read new lines
//! as they are written by a detached Claude CLI process.

use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Polling interval for tailing NDJSON files (50ms)
pub const POLL_INTERVAL: Duration = Duration::from_millis(50);

/// Maximum buffered bytes for an incomplete line.
///
/// If the writer outputs a line without a newline for too long, the buffer can
/// grow unbounded. When this cap is exceeded, we flush the buffer as a best-
/// effort line and clear it.
const MAX_INCOMPLETE_LINE_BYTES: usize = 2 * 1024 * 1024;

/// Tailer for reading new lines from an NDJSON file.
///
/// Maintains position in the file and returns only new complete lines
/// since the last poll.
pub struct NdjsonTailer {
    path: PathBuf,
    fingerprint: Vec<u8>,
    reader: BufReader<File>,
    /// Buffer for incomplete lines (no trailing newline yet)
    buffer: String,
}

impl NdjsonTailer {
    fn read_fingerprint(path: &Path) -> Result<Vec<u8>, String> {
        let mut file =
            File::open(path).map_err(|e| format!("Failed to open file for fingerprint: {e}"))?;
        let mut buf = vec![0u8; 64];
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("Failed to read file for fingerprint: {e}"))?;
        buf.truncate(n);
        Ok(buf)
    }

    /// Create a new tailer, starting from the current end of file.
    ///
    /// This is used when starting to tail a file that's being written to,
    /// where we only want new content.
    #[allow(dead_code)] // Used in tests
    pub fn new_at_end(path: &Path) -> Result<Self, String> {
        let fingerprint = Self::read_fingerprint(path)?;
        let file = File::open(path).map_err(|e| format!("Failed to open file for tailing: {e}"))?;

        let mut reader = BufReader::new(file);

        // Seek to end of file
        reader
            .seek(SeekFrom::End(0))
            .map_err(|e| format!("Failed to seek to end of file: {e}"))?;

        Ok(Self {
            path: path.to_path_buf(),
            fingerprint,
            reader,
            buffer: String::new(),
        })
    }

    /// Create a new tailer, starting from the beginning of file.
    ///
    /// This is used when resuming a session where we need to read
    /// all existing content first.
    pub fn new_from_start(path: &Path) -> Result<Self, String> {
        let fingerprint = Self::read_fingerprint(path)?;
        let file = File::open(path).map_err(|e| format!("Failed to open file for tailing: {e}"))?;

        let reader = BufReader::new(file);

        Ok(Self {
            path: path.to_path_buf(),
            fingerprint,
            reader,
            buffer: String::new(),
        })
    }

    fn reopen_from_start(&mut self) -> Result<(), String> {
        self.fingerprint = Self::read_fingerprint(&self.path)?;
        let file = File::open(&self.path)
            .map_err(|e| format!("Failed to reopen file for tailing: {e}"))?;
        self.reader = BufReader::new(file);
        self.buffer.clear();
        Ok(())
    }

    /// Poll for new complete lines.
    ///
    /// Returns a vector of complete lines (without trailing newlines).
    /// Incomplete lines (no newline yet) are buffered until complete.
    pub fn poll(&mut self) -> Result<Vec<String>, String> {
        let mut reopened_this_poll = false;

        loop {
            let mut lines = Vec::new();

            // Handle file truncation: if the underlying file shrank behind our
            // current stream position, reopen and restart from beginning.
            let current_pos = self
                .reader
                .stream_position()
                .map_err(|e| format!("Failed to read stream position: {e}"))?;
            let file_len = self
                .reader
                .get_ref()
                .metadata()
                .map_err(|e| format!("Failed to read file metadata: {e}"))?
                .len();
            if file_len < current_pos {
                self.reopen_from_start()?;
                reopened_this_poll = true;
            }

            // NOTE: We intentionally avoid using fingerprint-based rotation detection
            // here, because small files (< fingerprint size) would change their
            // fingerprint on normal appends.

            loop {
                let mut line = String::new();
                match self.reader.read_line(&mut line) {
                    Ok(0) => {
                        // EOF reached, no more data available right now
                        break;
                    }
                    Ok(_) => {
                        // Add to buffer
                        self.buffer.push_str(&line);

                        if self.buffer.len() > MAX_INCOMPLETE_LINE_BYTES {
                            // Best-effort flush to avoid unbounded growth.
                            // Find a valid UTF-8 boundary at or before the byte cap.
                            let cut = self
                                .buffer
                                .char_indices()
                                .take_while(|(i, _)| *i < MAX_INCOMPLETE_LINE_BYTES)
                                .last()
                                .map(|(i, ch)| i + ch.len_utf8())
                                .unwrap_or(0);
                            lines.push(self.buffer[..cut].to_string());
                            self.buffer.clear();
                            continue;
                        }

                        // Check if we have a complete line (ends with newline)
                        if self.buffer.ends_with('\n') {
                            // Remove the trailing newline and add to results
                            let complete_line =
                                self.buffer.trim_end_matches(['\n', '\r']).to_string();
                            lines.push(complete_line);
                            self.buffer.clear();
                        }
                        // If no newline, keep buffering (incomplete line)
                    }
                    Err(e) => {
                        return Err(format!("Error reading line: {e}"));
                    }
                }
            }

            // If we didn't get any new lines but the file appears to have been replaced/
            // rewritten, reopen and retry once.
            if !reopened_this_poll
                && lines.is_empty()
                && self.buffer.is_empty()
                && self.fingerprint.len() == 64
            {
                let current_pos = self
                    .reader
                    .stream_position()
                    .map_err(|e| format!("Failed to read stream position: {e}"))?;
                let file_len = self
                    .reader
                    .get_ref()
                    .metadata()
                    .map_err(|e| format!("Failed to read file metadata: {e}"))?
                    .len();
                if current_pos == file_len && current_pos > 0 {
                    if let Ok(fp) = Self::read_fingerprint(&self.path) {
                        if fp.len() == 64 && fp != self.fingerprint {
                            self.reopen_from_start()?;
                            reopened_this_poll = true;
                            continue;
                        }
                    }
                }
            }

            if !lines.is_empty() {
                if let Ok(fp) = Self::read_fingerprint(&self.path) {
                    self.fingerprint = fp;
                }
            }

            return Ok(lines);
        }
    }

    /// Flush any buffered incomplete data as a final line.
    ///
    /// Useful after the writer process exits, in case the last line didn't end
    /// with a newline.
    pub fn flush_buffer(&mut self) -> Option<String> {
        if self.buffer.is_empty() {
            return None;
        }

        let line = self.buffer.trim_end_matches(['\n', '\r']).to_string();
        self.buffer.clear();
        if line.trim().is_empty() {
            None
        } else {
            Some(line)
        }
    }

    /// Check if there's any buffered incomplete data.
    #[allow(dead_code)] // Used in tests
    pub fn has_incomplete_data(&self) -> bool {
        !self.buffer.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Seek, Write};
    use tempfile::NamedTempFile;

    #[test]
    fn test_tailer_new_lines() {
        let mut file = NamedTempFile::new().unwrap();
        let path = file.path().to_path_buf();

        // Write initial content
        writeln!(file, r#"{{"type": "init"}}"#).unwrap();
        file.flush().unwrap();

        // Create tailer at end
        let mut tailer = NdjsonTailer::new_at_end(&path).unwrap();

        // Poll should return nothing (we're at end)
        let lines = tailer.poll().unwrap();
        assert!(lines.is_empty());

        // Write new content
        writeln!(file, r#"{{"type": "message", "content": "hello"}}"#).unwrap();
        file.flush().unwrap();

        // Poll should return the new line
        let lines = tailer.poll().unwrap();
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("hello"));
    }

    #[test]
    fn test_tailer_incomplete_line() {
        let mut file = NamedTempFile::new().unwrap();
        let path = file.path().to_path_buf();

        let mut tailer = NdjsonTailer::new_from_start(&path).unwrap();

        // Write partial line (no newline)
        // Note: write! interprets {{ as escaped {, so we get {"type": "partial
        write!(file, r#"{{"type": "partial"#).unwrap();
        file.flush().unwrap();

        // Poll should return nothing (incomplete)
        let lines = tailer.poll().unwrap();
        assert!(lines.is_empty());
        assert!(tailer.has_incomplete_data());

        // Complete the line
        // Note: writeln! interprets }} as escaped }
        writeln!(file, r#"}}"#).unwrap();
        file.flush().unwrap();

        // Now poll should return the complete line
        // Combined: {"type": "partial} (single braces due to format string escaping)
        let lines = tailer.poll().unwrap();
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0], r#"{"type": "partial}"#);
        assert!(!tailer.has_incomplete_data());
    }

    #[test]
    fn test_tailer_multiple_lines() {
        let mut file = NamedTempFile::new().unwrap();
        let path = file.path().to_path_buf();

        let mut tailer = NdjsonTailer::new_from_start(&path).unwrap();

        // Write multiple lines at once
        writeln!(file, r#"{{"type": "line1"}}"#).unwrap();
        writeln!(file, r#"{{"type": "line2"}}"#).unwrap();
        writeln!(file, r#"{{"type": "line3"}}"#).unwrap();
        file.flush().unwrap();

        // Poll should return all three lines
        let lines = tailer.poll().unwrap();
        assert_eq!(lines.len(), 3);
        assert!(lines[0].contains("line1"));
        assert!(lines[1].contains("line2"));
        assert!(lines[2].contains("line3"));
    }

    #[test]
    fn test_tailer_empty_file() {
        let file = NamedTempFile::new().unwrap();
        let path = file.path().to_path_buf();

        let mut tailer = NdjsonTailer::new_from_start(&path).unwrap();

        // Poll should return nothing for empty file
        let lines = tailer.poll().unwrap();
        assert!(lines.is_empty());
        assert!(!tailer.has_incomplete_data());
    }

    #[test]
    fn test_tailer_very_long_line() {
        let mut file = NamedTempFile::new().unwrap();
        let path = file.path().to_path_buf();

        let mut tailer = NdjsonTailer::new_from_start(&path).unwrap();

        // Write a very long line (simulating large JSON output)
        let long_content: String = "x".repeat(100_000);
        writeln!(file, r#"{{"content": "{}"}}"#, long_content).unwrap();
        file.flush().unwrap();

        let lines = tailer.poll().unwrap();
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains(&long_content));
    }

    #[test]
    fn test_tailer_interleaved_writes() {
        let mut file = NamedTempFile::new().unwrap();
        let path = file.path().to_path_buf();

        let mut tailer = NdjsonTailer::new_from_start(&path).unwrap();

        // Write first line
        writeln!(file, r#"{{"type": "first"}}"#).unwrap();
        file.flush().unwrap();

        let lines = tailer.poll().unwrap();
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("first"));

        // Poll again - should be empty
        let lines = tailer.poll().unwrap();
        assert!(lines.is_empty());

        // Write second line
        writeln!(file, r#"{{"type": "second"}}"#).unwrap();
        file.flush().unwrap();

        let lines = tailer.poll().unwrap();
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("second"));
    }

    #[test]
    fn test_tailer_new_at_end_ignores_existing() {
        let mut file = NamedTempFile::new().unwrap();
        let path = file.path().to_path_buf();

        // Write content before creating tailer
        writeln!(file, r#"{{"type": "existing1"}}"#).unwrap();
        writeln!(file, r#"{{"type": "existing2"}}"#).unwrap();
        file.flush().unwrap();

        // Create tailer at end - should ignore existing content
        let mut tailer = NdjsonTailer::new_at_end(&path).unwrap();

        let lines = tailer.poll().unwrap();
        assert!(lines.is_empty());

        // New content should be captured
        writeln!(file, r#"{{"type": "new"}}"#).unwrap();
        file.flush().unwrap();

        let lines = tailer.poll().unwrap();
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("new"));
    }

    #[test]
    fn test_tailer_new_from_start_reads_all() {
        let mut file = NamedTempFile::new().unwrap();
        let path = file.path().to_path_buf();

        // Write content before creating tailer
        writeln!(file, r#"{{"type": "line1"}}"#).unwrap();
        writeln!(file, r#"{{"type": "line2"}}"#).unwrap();
        file.flush().unwrap();

        // Create tailer from start - should read all existing content
        let mut tailer = NdjsonTailer::new_from_start(&path).unwrap();

        let lines = tailer.poll().unwrap();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].contains("line1"));
        assert!(lines[1].contains("line2"));
    }

    #[test]
    fn test_tailer_handles_crlf_line_endings() {
        let mut file = NamedTempFile::new().unwrap();
        let path = file.path().to_path_buf();

        let mut tailer = NdjsonTailer::new_from_start(&path).unwrap();

        // Write with CRLF line endings (Windows-style)
        write!(file, "{}\r\n", r#"{"type": "crlf"}"#).unwrap();
        file.flush().unwrap();

        let lines = tailer.poll().unwrap();
        assert_eq!(lines.len(), 1);
        // trim_end_matches('\n') leaves \r, but that's OK for JSON parsing
        assert!(lines[0].contains(r#""type": "crlf""#));
    }

    #[test]
    fn test_poll_interval_constant() {
        // Verify the poll interval is a reasonable value
        assert_eq!(POLL_INTERVAL, Duration::from_millis(50));
        // Should be at least 10ms to avoid busy-waiting
        assert!(POLL_INTERVAL >= Duration::from_millis(10));
        // Should be at most 200ms for responsiveness
        assert!(POLL_INTERVAL <= Duration::from_millis(200));
    }

    #[test]
    fn test_tailer_flush_buffer_returns_final_line() {
        let mut file = NamedTempFile::new().unwrap();
        let path = file.path().to_path_buf();

        let mut tailer = NdjsonTailer::new_from_start(&path).unwrap();

        // Note: format macros treat { } specially; escape as {{ }}.
        write!(file, r#"{{"type":"partial"}}"#).unwrap();
        file.flush().unwrap();

        let lines = tailer.poll().unwrap();
        assert!(lines.is_empty());
        let flushed = tailer.flush_buffer();
        assert_eq!(flushed.as_deref(), Some(r#"{"type":"partial"}"#));
    }

    #[test]
    fn test_tailer_handles_truncation() {
        let mut file = NamedTempFile::new().unwrap();
        let path = file.path().to_path_buf();

        // Write one line and read it
        let padding: String = "x".repeat(512);
        writeln!(file, r#"{{"type":"first","pad":"{}"}}"#, padding).unwrap();
        file.flush().unwrap();

        let mut tailer = NdjsonTailer::new_from_start(&path).unwrap();
        let lines = tailer.poll().unwrap();
        assert_eq!(lines.len(), 1);

        // Truncate file and write new line
        file.as_file().set_len(0).unwrap();
        file.as_file().rewind().unwrap();
        writeln!(file, r#"{{"type":"second"}}"#).unwrap();
        file.flush().unwrap();

        let lines = tailer.poll().unwrap();
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("second"));
    }
}
