//! Integration tests for the export_protocol CLI binary.
//!
//! These tests verify AC-1.1: "Protocol tags, wire formats, and version constants
//! are defined in Rust and exported to JS/TS."
//!
//! The tests run the actual binary and verify:
//! 1. JSON output is valid and contains all required fields
//! 2. TypeScript output is syntactically valid
//! 3. Compact JSON output is valid
//! 4. File output works correctly

use std::process::Command;

/// Helper to run the export_protocol binary with given arguments.
fn run_export(args: &[&str]) -> (bool, String, String) {
    let output = Command::new(env!("CARGO_BIN_EXE_export_protocol"))
        .args(args)
        .output()
        .expect("Failed to run export_protocol binary");

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    (output.status.success(), stdout, stderr)
}

/// AC-1.1: Export binary produces valid JSON output.
#[test]
fn test_export_json_output_valid_ac_1_1() {
    let (success, stdout, stderr) = run_export(&[]);

    assert!(success, "export_protocol should succeed. stderr: {}", stderr);

    // Parse the output as JSON
    let parsed: serde_json::Value =
        serde_json::from_str(&stdout).expect("Output should be valid JSON");

    // Required top-level fields
    assert!(
        parsed.get("schema_version").is_some(),
        "schema_version missing"
    );
    assert!(parsed.get("versions").is_some(), "versions missing");
    assert!(parsed.get("size_bounds").is_some(), "size_bounds missing");
    assert!(
        parsed.get("domain_prefixes").is_some(),
        "domain_prefixes missing"
    );
    assert!(
        parsed.get("reveal_phases").is_some(),
        "reveal_phases missing"
    );
    assert!(
        parsed.get("wire_formats").is_some(),
        "wire_formats missing"
    );
    assert!(
        parsed.get("consensus_payload_tags").is_some(),
        "consensus_payload_tags missing"
    );
    assert!(
        parsed.get("game_action_codes").is_some(),
        "game_action_codes missing"
    );
    assert!(
        parsed.get("disabled_features").is_some(),
        "disabled_features missing"
    );
}

/// AC-1.1: Export binary produces valid compact JSON output.
#[test]
fn test_export_compact_json_output_valid_ac_1_1() {
    let (success, stdout, stderr) = run_export(&["--compact"]);

    assert!(
        success,
        "export_protocol --compact should succeed. stderr: {}",
        stderr
    );

    // Compact output should not contain newlines
    assert!(
        !stdout.contains('\n') || stdout.trim_end().matches('\n').count() == 0,
        "Compact output should not have internal newlines"
    );

    // Parse the output as JSON
    let parsed: serde_json::Value =
        serde_json::from_str(&stdout).expect("Compact output should be valid JSON");

    // Verify schema version is present
    assert!(
        parsed.get("schema_version").is_some(),
        "schema_version missing in compact output"
    );
}

/// AC-1.1: Export binary produces TypeScript output.
#[test]
fn test_export_typescript_output_valid_ac_1_1() {
    let (success, stdout, stderr) = run_export(&["--typescript"]);

    assert!(
        success,
        "export_protocol --typescript should succeed. stderr: {}",
        stderr
    );

    // TypeScript output should contain expected constructs
    assert!(
        stdout.contains("export const EXPORT_SCHEMA_VERSION"),
        "Missing EXPORT_SCHEMA_VERSION in TypeScript output"
    );
    assert!(
        stdout.contains("export const PROTOCOL_VERSIONS"),
        "Missing PROTOCOL_VERSIONS in TypeScript output"
    );
    assert!(
        stdout.contains("export const SIZE_BOUNDS"),
        "Missing SIZE_BOUNDS in TypeScript output"
    );
    assert!(
        stdout.contains("export const DOMAIN_PREFIXES"),
        "Missing DOMAIN_PREFIXES in TypeScript output"
    );
    assert!(
        stdout.contains("export enum RevealPhase"),
        "Missing RevealPhase enum in TypeScript output"
    );
    assert!(
        stdout.contains("export const CONSENSUS_PAYLOAD_TAGS"),
        "Missing CONSENSUS_PAYLOAD_TAGS in TypeScript output"
    );
    assert!(
        stdout.contains("export const GAME_ACTION_CODES"),
        "Missing GAME_ACTION_CODES in TypeScript output"
    );
    assert!(
        stdout.contains("export const DISABLED_FEATURES"),
        "Missing DISABLED_FEATURES in TypeScript output"
    );
    assert!(
        stdout.contains("as const"),
        "TypeScript output should use 'as const' for const assertions"
    );

    // Should have the auto-generated header
    assert!(
        stdout.contains("Auto-generated"),
        "TypeScript output should have auto-generated header"
    );
    assert!(
        stdout.contains("DO NOT EDIT"),
        "TypeScript output should have DO NOT EDIT warning"
    );
}

/// AC-1.1: Export binary file output works correctly.
#[test]
fn test_export_to_file_ac_1_1() {
    let temp_dir = std::env::temp_dir();
    let output_path = temp_dir.join("protocol_export_test.json");

    // Clean up any previous test file
    let _ = std::fs::remove_file(&output_path);

    let (success, _stdout, stderr) =
        run_export(&["--output", output_path.to_str().unwrap()]);

    assert!(
        success,
        "export_protocol --output should succeed. stderr: {}",
        stderr
    );

    // Verify file was created
    assert!(output_path.exists(), "Output file should be created");

    // Read and parse the file
    let contents = std::fs::read_to_string(&output_path).expect("Should read output file");
    let _parsed: serde_json::Value =
        serde_json::from_str(&contents).expect("File contents should be valid JSON");

    // Clean up
    let _ = std::fs::remove_file(&output_path);
}

/// AC-1.1: Export binary --help works.
#[test]
fn test_export_help_ac_1_1() {
    let (success, _stdout, stderr) = run_export(&["--help"]);

    // --help should succeed (exit 0)
    assert!(success, "export_protocol --help should succeed");

    // stderr should contain usage info
    assert!(
        stderr.contains("Usage") || stderr.contains("export_protocol"),
        "Help should contain usage information"
    );
}

/// AC-1.1: JSON output is deterministic (same output on repeated runs).
#[test]
fn test_export_deterministic_ac_1_1() {
    let (success1, stdout1, _) = run_export(&[]);
    let (success2, stdout2, _) = run_export(&[]);

    assert!(success1 && success2, "Both runs should succeed");
    assert_eq!(
        stdout1, stdout2,
        "Export output should be deterministic across runs"
    );
}

/// AC-1.1: Version constants in export match protocol-messages crate constants.
#[test]
fn test_export_version_matches_crate_ac_1_1() {
    use protocol_messages::{CURRENT_PROTOCOL_VERSION, MAX_SUPPORTED_PROTOCOL_VERSION, MIN_SUPPORTED_PROTOCOL_VERSION};

    let (success, stdout, _) = run_export(&[]);
    assert!(success, "export should succeed");

    let parsed: serde_json::Value = serde_json::from_str(&stdout).unwrap();

    assert_eq!(
        parsed["versions"]["current"].as_u64().unwrap(),
        CURRENT_PROTOCOL_VERSION as u64,
        "Export current version should match crate constant"
    );
    assert_eq!(
        parsed["versions"]["minimum"].as_u64().unwrap(),
        MIN_SUPPORTED_PROTOCOL_VERSION as u64,
        "Export minimum version should match crate constant"
    );
    assert_eq!(
        parsed["versions"]["maximum"].as_u64().unwrap(),
        MAX_SUPPORTED_PROTOCOL_VERSION as u64,
        "Export maximum version should match crate constant"
    );
}

/// AC-1.1: Size bounds in export match protocol-messages crate constants.
#[test]
fn test_export_size_bounds_match_crate_ac_1_1() {
    use protocol_messages::{
        MAX_ARTIFACT_HASHES, MAX_ARTIFACT_SIZE, MAX_REVEAL_CARDS, MAX_REVEAL_DATA_SIZE,
        MAX_SEATS, MAX_SIGNATURE_SIZE, MAX_TIMELOCK_PROOF_SIZE,
    };

    let (success, stdout, _) = run_export(&[]);
    assert!(success, "export should succeed");

    let parsed: serde_json::Value = serde_json::from_str(&stdout).unwrap();

    assert_eq!(
        parsed["size_bounds"]["max_seats"].as_u64().unwrap(),
        MAX_SEATS as u64
    );
    assert_eq!(
        parsed["size_bounds"]["max_artifact_hashes"]
            .as_u64()
            .unwrap(),
        MAX_ARTIFACT_HASHES as u64
    );
    assert_eq!(
        parsed["size_bounds"]["max_reveal_cards"].as_u64().unwrap(),
        MAX_REVEAL_CARDS as u64
    );
    assert_eq!(
        parsed["size_bounds"]["max_reveal_data_size"]
            .as_u64()
            .unwrap(),
        MAX_REVEAL_DATA_SIZE as u64
    );
    assert_eq!(
        parsed["size_bounds"]["max_timelock_proof_size"]
            .as_u64()
            .unwrap(),
        MAX_TIMELOCK_PROOF_SIZE as u64
    );
    assert_eq!(
        parsed["size_bounds"]["max_signature_size"].as_u64().unwrap(),
        MAX_SIGNATURE_SIZE as u64
    );
    assert_eq!(
        parsed["size_bounds"]["max_artifact_size"].as_u64().unwrap(),
        MAX_ARTIFACT_SIZE as u64
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Golden Vectors Tests (AC-3.2, AC-4.2)
// ─────────────────────────────────────────────────────────────────────────────

/// AC-3.2, AC-4.2: Export binary produces valid golden vectors JSON output.
#[test]
fn test_export_golden_vectors_valid_ac_3_2_ac_4_2() {
    let (success, stdout, stderr) = run_export(&["--golden-vectors"]);

    assert!(
        success,
        "export_protocol --golden-vectors should succeed. stderr: {}",
        stderr
    );

    // Parse the output as JSON
    let parsed: serde_json::Value =
        serde_json::from_str(&stdout).expect("Golden vectors output should be valid JSON");

    // Required top-level fields
    assert!(
        parsed.get("schema_version").is_some(),
        "schema_version missing in golden vectors"
    );
    assert!(
        parsed.get("vectors").is_some(),
        "vectors missing in golden vectors"
    );

    // Vectors should be a non-empty array
    let vectors = parsed["vectors"].as_array().expect("vectors should be an array");
    assert!(
        !vectors.is_empty(),
        "vectors array should not be empty"
    );
}

/// AC-4.2: Golden vectors export is deterministic.
#[test]
fn test_export_golden_vectors_deterministic_ac_4_2() {
    let (success1, stdout1, _) = run_export(&["--golden-vectors"]);
    let (success2, stdout2, _) = run_export(&["--golden-vectors"]);

    assert!(success1 && success2, "Both golden vector runs should succeed");
    assert_eq!(
        stdout1, stdout2,
        "Golden vectors export should be deterministic across runs"
    );
}

/// AC-3.2, AC-4.2: Golden vectors contain expected message types.
#[test]
fn test_export_golden_vectors_coverage_ac_3_2() {
    let (success, stdout, _) = run_export(&["--golden-vectors"]);
    assert!(success, "export should succeed");

    let parsed: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    let vectors = parsed["vectors"].as_array().unwrap();

    // Check for expected message types
    let message_types: Vec<&str> = vectors
        .iter()
        .map(|v| v["message_type"].as_str().unwrap())
        .collect();

    assert!(
        message_types.contains(&"ScopeBinding"),
        "Should have ScopeBinding vectors"
    );
    assert!(
        message_types.contains(&"ShuffleContext"),
        "Should have ShuffleContext vectors"
    );
    assert!(
        message_types.contains(&"DealCommitment"),
        "Should have DealCommitment vectors"
    );
    assert!(
        message_types.contains(&"DealCommitmentAck"),
        "Should have DealCommitmentAck vectors"
    );
    assert!(
        message_types.contains(&"RevealShare"),
        "Should have RevealShare vectors"
    );
    assert!(
        message_types.contains(&"TimelockReveal"),
        "Should have TimelockReveal vectors"
    );
    assert!(
        message_types.contains(&"ArtifactRequest"),
        "Should have ArtifactRequest vectors"
    );
    assert!(
        message_types.contains(&"ArtifactResponse"),
        "Should have ArtifactResponse vectors"
    );
}

/// AC-3.2: Golden vectors contain hex-encoded preimages.
#[test]
fn test_export_golden_vectors_hex_format_ac_3_2() {
    let (success, stdout, _) = run_export(&["--golden-vectors"]);
    assert!(success, "export should succeed");

    let parsed: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    let vectors = parsed["vectors"].as_array().unwrap();

    for vector in vectors {
        let name = vector["name"].as_str().unwrap();

        // preimage_hex should be present and valid hex
        let preimage_hex = vector["preimage_hex"]
            .as_str()
            .expect(&format!("Vector '{}' missing preimage_hex", name));
        assert!(
            hex::decode(preimage_hex).is_ok(),
            "Vector '{}' preimage_hex should be valid hex",
            name
        );

        // hash_hex should be present and valid hex (32 bytes = 64 hex chars)
        let hash_hex = vector["hash_hex"]
            .as_str()
            .expect(&format!("Vector '{}' missing hash_hex", name));
        let hash_bytes = hex::decode(hash_hex)
            .expect(&format!("Vector '{}' hash_hex should be valid hex", name));
        assert_eq!(
            hash_bytes.len(),
            32,
            "Vector '{}' hash should be 32 bytes",
            name
        );

        // preimage_length should match actual preimage length
        let preimage_length = vector["preimage_length"].as_u64().unwrap() as usize;
        let actual_length = hex::decode(preimage_hex).unwrap().len();
        assert_eq!(
            preimage_length, actual_length,
            "Vector '{}' preimage_length should match actual length",
            name
        );
    }
}

/// AC-4.2: Golden vectors file output works.
#[test]
fn test_export_golden_vectors_to_file_ac_4_2() {
    let temp_dir = std::env::temp_dir();
    let output_path = temp_dir.join("golden_vectors_export_test.json");

    // Clean up any previous test file
    let _ = std::fs::remove_file(&output_path);

    let (success, _stdout, stderr) =
        run_export(&["--golden-vectors", "--output", output_path.to_str().unwrap()]);

    assert!(
        success,
        "export_protocol --golden-vectors --output should succeed. stderr: {}",
        stderr
    );

    // Verify file was created
    assert!(output_path.exists(), "Output file should be created");

    // Read and parse the file
    let contents = std::fs::read_to_string(&output_path).expect("Should read output file");
    let parsed: serde_json::Value =
        serde_json::from_str(&contents).expect("File contents should be valid JSON");

    // Verify it has vectors
    assert!(
        parsed.get("vectors").is_some(),
        "Golden vectors file should contain vectors"
    );

    // Clean up
    let _ = std::fs::remove_file(&output_path);
}

/// AC-4.2: Golden vectors compact output works.
#[test]
fn test_export_golden_vectors_compact_ac_4_2() {
    let (success, stdout, stderr) = run_export(&["--golden-vectors", "--compact"]);

    assert!(
        success,
        "export_protocol --golden-vectors --compact should succeed. stderr: {}",
        stderr
    );

    // Compact output should not contain pretty-print newlines
    // (may have trailing newline, so we check for internal structure)
    let trimmed = stdout.trim();
    let internal_newlines = trimmed.matches('\n').count();
    assert_eq!(
        internal_newlines, 0,
        "Compact golden vectors should not have internal newlines"
    );

    // Should still be valid JSON
    let _parsed: serde_json::Value =
        serde_json::from_str(&stdout).expect("Compact output should be valid JSON");
}
