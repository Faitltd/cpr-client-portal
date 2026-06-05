-- Add zoho_sign_request to bot_documents.source allowlist so the Sign
-- ingester can persist Zoho Sign envelopes / requests for the bot.

ALTER TABLE bot_documents DROP CONSTRAINT IF EXISTS bot_documents_source_check;

ALTER TABLE bot_documents
    ADD CONSTRAINT bot_documents_source_check
    CHECK (source IN (
        'zoho_mail',
        'zoho_cliq_internal',
        'zoho_cliq_external',
        'zoho_crm_note',
        'zoho_crm_field',
        'zoho_books_invoice',
        'zoho_books_estimate',
        'zoho_books_payment',
        'workdrive_pdf',
        'workdrive_docx',
        'workdrive_xlsx',
        'zoho_projects_task',
        'zoho_projects_activity',
        'zoho_sign_request',
        'transcript',
        'sms'
    ));
