-- Migration 00007: Trigger to automatically assign clean commercial reference (ZM-[CAT]-[SEQ])
-- if reference is NULL, empty, or equal to UUID upon INSERT on products table.

CREATE OR REPLACE FUNCTION public.auto_generate_product_reference()
RETURNS TRIGGER AS $$
DECLARE
  v_prefix text;
  v_seq int;
  v_text text;
BEGIN
  -- If reference is provided and is NOT a 36-char UUID, keep it.
  IF NEW.reference IS NOT NULL 
     AND trim(NEW.reference) <> '' 
     AND NEW.reference !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RETURN NEW;
  END IF;

  v_text := upper(coalesce(NEW.name, '') || ' ' || coalesce(NEW.notes, ''));

  IF v_text LIKE '%MUG%' OR v_text LIKE '%POCILLO%' OR v_text LIKE '%VASO%' OR v_text LIKE '%TERMO%' THEN
    v_prefix := 'MUG';
  ELSIF v_text LIKE '%CUADERNO%' OR v_text LIKE '%LIBRETA%' OR v_text LIKE '%AGENDA%' THEN
    v_prefix := 'CUA';
  ELSIF v_text LIKE '%BOTON%' OR v_text LIKE '%BOTÓN%' OR v_text LIKE '%PIN%' THEN
    v_prefix := 'BOT';
  ELSIF v_text LIKE '%PAD MOUSE%' OR v_text LIKE '%MOUSE PAD%' OR v_text LIKE '%MOUSEPAD%' THEN
    v_prefix := 'PAD';
  ELSIF v_text LIKE '%TARJETA%' OR v_text LIKE '%VOLANTE%' OR v_text LIKE '%AFICHE%' OR v_text LIKE '%PENDON%' OR v_text LIKE '%PENDÓN%' THEN
    v_prefix := 'TAR';
  ELSIF v_text LIKE '%GORRA%' OR v_text LIKE '%CAMISETA%' OR v_text LIKE '%BUZO%' OR v_text LIKE '%HOODIE%' OR v_text LIKE '%TEXTIL%' THEN
    v_prefix := 'TEX';
  ELSIF v_text LIKE '%BOLIGRAFO%' OR v_text LIKE '%BOLÍGRAFO%' OR v_text LIKE '%ESFERO%' OR v_text LIKE '%LAPICERO%' OR v_text LIKE '%LAPIZ%' OR v_text LIKE '%LÁPIZ%' THEN
    v_prefix := 'ESF';
  ELSIF v_text LIKE '%USB%' OR v_text LIKE '%MEMORIA%' OR v_text LIKE '%TECNOLOGIA%' OR v_text LIKE '%TECNOLOGÍA%' THEN
    v_prefix := 'TEC';
  ELSIF v_text LIKE '%LLAVERO%' THEN
    v_prefix := 'LLA';
  ELSE
    v_prefix := 'GEN';
  END IF;

  SELECT coalesce(max(cast(split_part(reference, '-', 3) AS integer)), 0) + 1
  INTO v_seq
  FROM public.products
  WHERE reference LIKE 'ZM-' || v_prefix || '-%';

  NEW.reference := 'ZM-' || v_prefix || '-' || lpad(v_seq::text, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_generate_product_reference ON public.products;
CREATE TRIGGER trg_auto_generate_product_reference
BEFORE INSERT ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.auto_generate_product_reference();
