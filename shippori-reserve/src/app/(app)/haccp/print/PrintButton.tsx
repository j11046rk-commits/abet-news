"use client";

export default function PrintButton() {
  return (
    <button type="button" className="btn btn-sm btn-primary" onClick={() => window.print()}>
      印刷する／PDFで保存
    </button>
  );
}
