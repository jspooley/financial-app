-- Allow Service as a wholesale/retail line type (treated like retail: no sales tax).
ALTER TYPE wholesale_retail_type ADD VALUE IF NOT EXISTS 'service';
