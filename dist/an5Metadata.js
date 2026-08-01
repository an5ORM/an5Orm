"use strict";
// This file is auto-generated. Do not edit directly.
Object.defineProperty(exports, "__esModule", { value: true });
exports.relationMap = exports.modelFields = exports.modelDescriptions = exports.modelToTable = void 0;
exports.modelToTable = {
    embeddingConfig: "[dbo].[embeddingconfigs]",
    llmConfig: "[dbo].[llmconfigs]",
    user: "[dbo].[users]",
    order: "[dbo].[orders]",
};
exports.modelDescriptions = {
    embeddingConfig: "Embedding provider configuration. Stores API keys and model settings for RAG features.",
    llmConfig: "LLM provider configuration. Stores API keys and model settings for AI features.",
    user: "Represents a registered user in the database.",
    order: "Represents a customer order in the system.",
};
exports.modelFields = {
    embeddingConfig: { id: { ts: "string", sql: "NVARCHAR(1000)", description: "Primary key" }, provider: { ts: "string", sql: "NVARCHAR(100)", description: "Embedding provider: openai, cohere, custom" }, apiKey: { ts: "string", sql: "NVARCHAR(4000)", description: "API key for the embedding service" }, model: { ts: "string?", sql: "NVARCHAR(500)", description: "Model name, e.g. text-embedding-3-small" }, endpoint: { ts: "string?", sql: "NVARCHAR(2000)", description: "Custom endpoint URL" }, isActive: { ts: "boolean", sql: "BIT", description: "Whether this config is active" }, createdAt: { ts: "Date", sql: "DATETIME2", description: "Creation timestamp" }, updatedAt: { ts: "Date", sql: "DATETIME2", description: "Last update timestamp" } },
    llmConfig: { id: { ts: "string", sql: "NVARCHAR(1000)", description: "Primary key" }, provider: { ts: "string", sql: "NVARCHAR(100)", description: "LLM provider: openai, gemini, custom, azure" }, apiKey: { ts: "string", sql: "NVARCHAR(4000)", description: "API key for the LLM provider" }, model: { ts: "string?", sql: "NVARCHAR(500)", description: "Model name, e.g. gpt-4o, gemini-2.5-flash" }, endpoint: { ts: "string?", sql: "NVARCHAR(2000)", description: "Custom endpoint URL" }, isActive: { ts: "boolean", sql: "BIT", description: "Whether this config is active" }, createdAt: { ts: "Date", sql: "DATETIME2", description: "Creation timestamp" }, updatedAt: { ts: "Date", sql: "DATETIME2", description: "Last update timestamp" } },
    user: { id: { ts: "string", sql: "NVARCHAR(1000)", description: "Primary key for the User table (auto-generated UUID)" }, email: { ts: "string", sql: "NVARCHAR(255)", description: "Unique email address used for login and notifications" }, name: { ts: "string?", sql: "NVARCHAR(255)", description: "Display name of the user" }, createdAt: { ts: "Date", sql: "DATETIME2", description: "Timestamp when the user profile was created" } },
    order: { id: { ts: "string", sql: "NVARCHAR(1000)", description: "Primary key for the Order table (auto-generated UUID)" }, userId: { ts: "string", sql: "NVARCHAR(1000)", description: "Foreign key linking to the User model who placed the order" }, total: { ts: "number", sql: "INT", description: "Total cost amount of the order" }, createdAt: { ts: "Date", sql: "DATETIME2", description: "The date and time when the order was created." } },
};
exports.relationMap = {
    embeddingConfig: {},
    llmConfig: {},
    user: {},
    order: {},
};
//# sourceMappingURL=an5Metadata.js.map