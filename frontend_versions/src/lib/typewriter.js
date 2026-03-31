export function getVisibleTypewriterSegments(segments = [], typedCount = 0) {
  let remainingCharacters = Math.max(0, typedCount);

  return segments.map((segment) => {
    const text = segment?.text ?? "";
    const visibleLength = Math.min(text.length, remainingCharacters);
    const visibleText = text.slice(0, visibleLength);

    remainingCharacters = Math.max(0, remainingCharacters - text.length);

    return {
      ...segment,
      text: visibleText,
    };
  });
}

export function getTypewriterCharacterCount(segments = []) {
  return segments.reduce((count, segment) => count + (segment?.text?.length ?? 0), 0);
}
