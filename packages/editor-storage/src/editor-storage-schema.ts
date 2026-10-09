import type { EditorStorageDatabase } from './database-driver'
import type { EmbeddingModel } from './embedding-model'
import { eq, sql } from 'drizzle-orm'
import { editorStorageEmbeddingConfiguration, topicBlockEmbeddingState } from './drizzle-schema'

const noteKindConstraints = `
  CREATE TRIGGER IF NOT EXISTS journals_insert_note_identity
  BEFORE INSERT ON journals
  WHEN NOT EXISTS (
    SELECT 1
    FROM notes
    WHERE row_id = new.note_row_id
      AND kind = 'journal'
      AND title = new.journal_date
      AND id = 'journal:' || new.journal_date
  )
  BEGIN
    SELECT RAISE(ABORT, 'Journal Note identity is invalid');
  END;

  CREATE TRIGGER IF NOT EXISTS journals_update_note_identity
  BEFORE UPDATE OF note_row_id, journal_date ON journals
  WHEN NOT EXISTS (
    SELECT 1
    FROM notes
    WHERE row_id = new.note_row_id
      AND kind = 'journal'
      AND title = new.journal_date
      AND id = 'journal:' || new.journal_date
  )
  BEGIN
    SELECT RAISE(ABORT, 'Journal Note identity is invalid');
  END;

  CREATE TRIGGER IF NOT EXISTS notes_update_journal_identity
  BEFORE UPDATE OF title, kind ON notes
  WHEN EXISTS (
    SELECT 1
    FROM journals
    WHERE note_row_id = old.row_id
      AND (new.kind <> 'journal' OR new.title <> journal_date)
  )
  BEGIN
    SELECT RAISE(ABORT, 'Journal Note identity is immutable');
  END;
`

const assetConstraints = `
  CREATE TRIGGER IF NOT EXISTS note_asset_references_insert_mark_referenced
  AFTER INSERT ON note_asset_references
  BEGIN
    UPDATE assets SET unreferenced_at = NULL WHERE file_name = new.asset_file_name;
  END;

  CREATE TRIGGER IF NOT EXISTS note_asset_references_delete_mark_unreferenced
  AFTER DELETE ON note_asset_references
  WHEN NOT EXISTS (
    SELECT 1 FROM note_asset_references WHERE asset_file_name = old.asset_file_name
  )
  BEGIN
    UPDATE assets
    SET unreferenced_at = COALESCE(
      unreferenced_at,
      CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
    )
    WHERE file_name = old.asset_file_name;
  END;

  CREATE TRIGGER IF NOT EXISTS note_asset_references_insert_available
  BEFORE INSERT ON note_asset_references
  WHEN (SELECT deletion_claimed_at FROM assets WHERE file_name = new.asset_file_name) IS NOT NULL
  BEGIN
    SELECT RAISE(ABORT, 'Asset is being reclaimed');
  END;

  CREATE TRIGGER IF NOT EXISTS note_asset_references_update_available
  BEFORE UPDATE OF asset_file_name ON note_asset_references
  WHEN (SELECT deletion_claimed_at FROM assets WHERE file_name = new.asset_file_name) IS NOT NULL
  BEGIN
    SELECT RAISE(ABORT, 'Asset is being reclaimed');
  END;
`

// SQLite extensions are intentionally kept outside the generated Drizzle migration:
// FTS5 and sqlite-vec are virtual tables whose layout is provided by the loaded
// extensions, not by the relational schema consumed by Drizzle.
const extensionSchema = `
  CREATE VIRTUAL TABLE IF NOT EXISTS topic_blocks_fts USING fts5(
    text,
    content='topic_blocks',
    content_rowid='row_id',
    tokenize='trigram'
  );

  CREATE TRIGGER IF NOT EXISTS topic_blocks_fts_insert
  AFTER INSERT ON topic_blocks BEGIN
    INSERT INTO topic_blocks_fts(rowid, text) VALUES (new.row_id, new.text);
  END;

  CREATE TRIGGER IF NOT EXISTS topic_blocks_fts_delete
  AFTER DELETE ON topic_blocks BEGIN
    INSERT INTO topic_blocks_fts(topic_blocks_fts, rowid, text)
      VALUES ('delete', old.row_id, old.text);
  END;

  CREATE TRIGGER IF NOT EXISTS topic_blocks_fts_update
  AFTER UPDATE OF text ON topic_blocks BEGIN
    INSERT INTO topic_blocks_fts(topic_blocks_fts, rowid, text)
      VALUES ('delete', old.row_id, old.text);
    INSERT INTO topic_blocks_fts(rowid, text) VALUES (new.row_id, new.text);
  END;
`

function vectorSchema(dimensions: number): string {
  return `
    CREATE VIRTUAL TABLE IF NOT EXISTS topic_block_embeddings USING vec0(
      block_row_id INTEGER PRIMARY KEY,
      note_row_id INTEGER PARTITION KEY,
      embedding FLOAT[${dimensions}]
    );
  `
}

function validateEmbeddingModel(model: EmbeddingModel): void {
  if (model.id.trim().length === 0)
    throw new TypeError('Embedding model id must be a non-empty string')
  if (!Number.isInteger(model.dimensions) || model.dimensions < 1)
    throw new RangeError('Embedding model dimensions must be a positive integer')
}

export async function initializeEditorStorageSchema(
  database: EditorStorageDatabase,
  embeddingModel: EmbeddingModel,
): Promise<void> {
  validateEmbeddingModel(embeddingModel)
  await database.migrate()
  await database.executeInfrastructureSql(assetConstraints)
  await database.executeInfrastructureSql(extensionSchema)
  await database.executeInfrastructureSql(noteKindConstraints)

  const configuration = database.drizzle.select({
    model_id: editorStorageEmbeddingConfiguration.modelId,
    dimensions: editorStorageEmbeddingConfiguration.dimensions,
  })
    .from(editorStorageEmbeddingConfiguration)
    .where(eq(editorStorageEmbeddingConfiguration.singleton, 1))
    .get()
  if (configuration && (
    configuration.model_id !== embeddingModel.id
    || configuration.dimensions !== embeddingModel.dimensions
  )) {
    await database.batch([
      { drizzle: orm => orm.run(sql`DROP TABLE IF EXISTS topic_block_embeddings`) },
      { drizzle: orm => orm.delete(topicBlockEmbeddingState).run() },
      {
        drizzle: orm => orm.update(editorStorageEmbeddingConfiguration).set({
          dimensions: embeddingModel.dimensions,
          modelId: embeddingModel.id,
        }).where(eq(editorStorageEmbeddingConfiguration.singleton, 1)).run(),
      },
    ])
  }

  await database.executeInfrastructureSql(vectorSchema(embeddingModel.dimensions))
  database.drizzle.insert(editorStorageEmbeddingConfiguration)
    .values({ singleton: 1, modelId: embeddingModel.id, dimensions: embeddingModel.dimensions })
    .onConflictDoNothing()
    .run()
}
