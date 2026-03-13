# Project Rules for AI Code Generation

## LOCKED FILES - DO NOT MODIFY

The following files are LOCKED and must NEVER be edited directly:

### pdfTextExtractor.ts

- Path: `src/components/catalog/quote-builder/pdfTextExtractor.ts`
- Status: **LOCKED v76** 
- Contains: Core PDF text extraction, price detection, product matching
- Tested against: Samsung, Daikin, Midea, One Stop Shop price lists
- If you need to add PDF-related functionality, create a NEW file that imports from pdfTextExtractor.ts
- NEVER change thresholds, regexes, dedup logic, or row processing in this file

## When Adding New Features

1. Check if the feature touches a locked file
2. If yes, create a wrapper/extension file instead
3. Import the locked module and extend it
4. Do NOT copy-paste code from locked files into new files and modify it
