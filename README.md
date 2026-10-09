# Resource Manager Studio

Bulk language-key tool for **Master Admin → Resource Manager only**.

## Flow

1. Select Project / Product / Module / Page (header)
2. Paste English texts + reference key
3. Review generated keys
4. Click **Translate all languages** (tabs only switch review language)
5. **Save** via `POST /LanguageFile/SaveCMSLanguageKey`
6. **Verify** via `POST /LanguageFile/GetCMSContent`

## APIs used

| Action | API |
|--------|-----|
| LOVs | `GET /lov/GetLOVByKeys/MODULE,PROJECT,PRODUCT` |
| Languages | `POST /LanguageMaster/GetAllLanguage` |
| Pages | `GET /LanguageFile/GetAllCMSPages` |
| Save keys | `POST /LanguageFile/SaveCMSLanguageKey` |
| Verify / show | `POST /LanguageFile/GetCMSContent` |
| Update text | `POST /LanguageFile/SaveCMSContent` (Master Admin list screen) |

## Run

```bash
cd "c:\IH Project\FTP\LanguageKeyBulkTool"
npm start
```

http://localhost:4300
