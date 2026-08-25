-- Training Datasets table for capturing scan/enrichment input-output pairs
-- Used for future custom LLM fine-tuning

CREATE TABLE IF NOT EXISTS training_datasets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_type VARCHAR(50) NOT NULL,  -- 'menu_scan', 'label_scan', 'enrichment', 'book_scrape', 'scan_confirmation', '*_correction'
    input_data JSONB NOT NULL DEFAULT '{}',  -- raw image info, OCR text, wine name, etc.
    output_data JSONB NOT NULL DEFAULT '{}',  -- structured wine fields, corrections, etc.
    model_version VARCHAR(50) DEFAULT 'gemini-2.0-flash',
    confidence DECIMAL(4,3) DEFAULT 0.000,
    human_verified BOOLEAN DEFAULT false,
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_training_datasets_type ON training_datasets(dataset_type);
CREATE INDEX IF NOT EXISTS idx_training_datasets_verified ON training_datasets(human_verified) WHERE human_verified = true;
CREATE INDEX IF NOT EXISTS idx_training_datasets_created ON training_datasets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_training_datasets_restaurant ON training_datasets(restaurant_id) WHERE restaurant_id IS NOT NULL;

-- Enable RLS
ALTER TABLE training_datasets ENABLE ROW LEVEL SECURITY;

-- Policy: service role can do everything
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'training_datasets' AND policyname = 'Service role full access on training_datasets'
  ) THEN
    CREATE POLICY "Service role full access on training_datasets"
      ON training_datasets FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMENT ON TABLE training_datasets IS 'Training data pairs for future custom LLM fine-tuning. Captures scan/enrichment input-output pairs.';
COMMENT ON COLUMN training_datasets.dataset_type IS 'Type: menu_scan, label_scan, enrichment, book_scrape, scan_confirmation, *_correction';
COMMENT ON COLUMN training_datasets.input_data IS 'Raw input data (image metadata, OCR text, wine name context)';
COMMENT ON COLUMN training_datasets.output_data IS 'Structured output (detected wines, enrichment fields, user corrections)';
COMMENT ON COLUMN training_datasets.human_verified IS 'Whether a human verified/corrected this pair (high-value for training)';
