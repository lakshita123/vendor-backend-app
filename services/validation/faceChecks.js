// ============================================================
// validation/faceChecks.js
// Face verification checks for geo tag photo vs identity docs
// ============================================================

function buildFaceChecks(faceResults, issues) {
  const checks = [];
  if (!faceResults || !faceResults.length) return checks;

  faceResults.forEach((result) => {
    if (result.error) {
      checks.push({
        title:       `Geo tag photo vs ${result.label} — face check skipped`,
        passed:      false,
        expected:    "Face detectable in both images",
        actual:      result.error,
        isFaceCheck: true,
        faceResult:  result,
      });

      issues.push({
        severity: "medium",
        title:    `Face verification skipped for ${result.label}`,
        detail:   `Automatic face comparison between the geo tag photo and ${result.label} could not run: ${result.error}`,
      });

      return;
    }

    const pct = Math.round((result.confidence || 0) * 100);

    checks.push({
      title:       `Geo tag photo vs ${result.label} — face match`,
      passed:      result.match,
      expected:    "Same person (confidence ≥ 45%)",
      actual:      result.match
        ? `Match confirmed — ${pct}% confidence`
        : `No match — ${pct}% confidence`,
      isFaceCheck: true,
      faceResult:  result,
    });

    if (!result.match) {
      issues.push({
        severity: "high",
        title:    `Face mismatch: geo tag photo vs ${result.label}`,
        detail:
          `The face in the geo tag photo does not match the face on the ${result.label} card. ` +
          `Similarity confidence: ${pct}% (threshold: 45%). ` +
          `Euclidean distance: ${result.distance !== null ? result.distance : "N/A"}. ` +
          `Manual verification of the vendor's identity is required.`,
      });
    }
  });

  return checks;
}

module.exports = { buildFaceChecks };
