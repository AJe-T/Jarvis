-- AI Router (2.33.1): each listed model's context window in tokens, as the provider's model list
-- reports it (OpenRouter context_length, Groq context_window). NULL = not published.
ALTER TABLE ai_models ADD COLUMN context_tokens INTEGER;
