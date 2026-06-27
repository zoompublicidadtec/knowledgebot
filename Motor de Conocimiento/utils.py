"""
============================================================================
UTILS.PY — Utilidades Compartidas del Sistema RAG Militar
============================================================================
Logging de auditoría, retry con backoff exponencial, helpers de I/O,
y funciones de validación compartidas por todos los módulos.
============================================================================
"""

import json
import time
import hashlib
import logging
import functools
import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

from config import LOGS_DIR, CHECKPOINT_DIR


# ============================================================================
# 1. SISTEMA DE LOGGING DE AUDITORÍA
# ============================================================================

def setup_logger(
    name: str,
    log_file: Optional[str] = None,
    level: int = logging.DEBUG
) -> logging.Logger:
    """
    Configura un logger con formato de auditoría militar.
    
    Args:
        name: Nombre del logger (módulo).
        log_file: Nombre del archivo de log (sin path).
        level: Nivel de logging.
    
    Returns:
        Logger configurado con handlers de consola y archivo.
    """
    logger = logging.getLogger(name)
    logger.setLevel(level)
    
    # Evitar duplicación de handlers
    if logger.handlers:
        return logger
    
    # Formato de auditoría
    formatter = logging.Formatter(
        fmt="[%(asctime)s] [%(levelname)-8s] [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )
    
    # Handler de consola
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)
    
    # Handler de archivo
    if log_file:
        file_path = LOGS_DIR / log_file
        file_handler = logging.FileHandler(file_path, encoding="utf-8")
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
    
    return logger


# ============================================================================
# 2. RETRY CON BACKOFF EXPONENCIAL
# ============================================================================

def retry_with_backoff(
    max_retries: int = 5,
    base_delay: float = 2.0,
    max_delay: float = 60.0,
    exceptions: tuple = (Exception,),
    logger: Optional[logging.Logger] = None
) -> Callable:
    """
    Decorador para reintentos con backoff exponencial.
    
    Implementa jitter para evitar thundering herd.
    Compatible con funciones sync y async.
    
    Args:
        max_retries: Número máximo de reintentos.
        base_delay: Delay base en segundos.
        max_delay: Delay máximo en segundos.
        exceptions: Tupla de excepciones capturables.
        logger: Logger para registrar reintentos.
    """
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        async def async_wrapper(*args, **kwargs):
            _logger = logger or logging.getLogger(func.__module__)
            last_exception = None
            
            for attempt in range(1, max_retries + 1):
                try:
                    return await func(*args, **kwargs)
                except exceptions as e:
                    last_exception = e
                    if attempt == max_retries:
                        _logger.error(
                            f"[FALLO FINAL] {func.__name__} falló tras "
                            f"{max_retries} intentos: {e}"
                        )
                        raise
                    
                    # Backoff exponencial con jitter
                    delay = min(base_delay * (2 ** (attempt - 1)), max_delay)
                    jitter = delay * 0.1 * (hash(str(e)) % 10) / 10
                    total_delay = delay + jitter
                    
                    _logger.warning(
                        f"[REINTENTO {attempt}/{max_retries}] "
                        f"{func.__name__}: {e} — "
                        f"Esperando {total_delay:.1f}s..."
                    )
                    await asyncio.sleep(total_delay)
            
            raise last_exception
        
        @functools.wraps(func)
        def sync_wrapper(*args, **kwargs):
            _logger = logger or logging.getLogger(func.__module__)
            last_exception = None
            
            for attempt in range(1, max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except exceptions as e:
                    last_exception = e
                    if attempt == max_retries:
                        _logger.error(
                            f"[FALLO FINAL] {func.__name__} falló tras "
                            f"{max_retries} intentos: {e}"
                        )
                        raise
                    
                    delay = min(base_delay * (2 ** (attempt - 1)), max_delay)
                    jitter = delay * 0.1 * (hash(str(e)) % 10) / 10
                    total_delay = delay + jitter
                    
                    _logger.warning(
                        f"[REINTENTO {attempt}/{max_retries}] "
                        f"{func.__name__}: {e} — "
                        f"Esperando {total_delay:.1f}s..."
                    )
                    time.sleep(total_delay)
            
            raise last_exception
        
        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return sync_wrapper
    
    return decorator


# ============================================================================
# 3. SISTEMA DE CHECKPOINTS (PERSISTENCIA DE PROGRESO)
# ============================================================================

class CheckpointManager:
    """
    Gestiona checkpoints de progreso para permitir reanudación
    después de interrupciones. Nivel militar de resiliencia.
    """
    
    def __init__(self, pipeline_name: str):
        self.pipeline_name = pipeline_name
        self.checkpoint_file = CHECKPOINT_DIR / f"{pipeline_name}_checkpoint.json"
        self.data = self._load()
    
    def _load(self) -> dict:
        """Carga checkpoint existente o crea uno nuevo."""
        if self.checkpoint_file.exists():
            with open(self.checkpoint_file, "r", encoding="utf-8") as f:
                return json.load(f)
        return {
            "pipeline": self.pipeline_name,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "last_updated": None,
            "processed_ids": [],
            "failed_ids": [],
            "stats": {
                "total_processed": 0,
                "total_failed": 0,
                "total_skipped": 0,
            }
        }
    
    def save(self) -> None:
        """Persiste el checkpoint actual a disco."""
        self.data["last_updated"] = datetime.now(timezone.utc).isoformat()
        with open(self.checkpoint_file, "w", encoding="utf-8") as f:
            json.dump(self.data, f, indent=2, ensure_ascii=False)
    
    def is_processed(self, item_id: str) -> bool:
        """Verifica si un item ya fue procesado exitosamente."""
        return item_id in self.data["processed_ids"]
    
    def mark_processed(self, item_id: str) -> None:
        """Marca un item como procesado exitosamente."""
        if item_id not in self.data["processed_ids"]:
            self.data["processed_ids"].append(item_id)
            self.data["stats"]["total_processed"] += 1
            self.save()
    
    def mark_failed(self, item_id: str, error: str) -> None:
        """Marca un item como fallido con detalle del error."""
        entry = {
            "id": item_id,
            "error": str(error),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        self.data["failed_ids"].append(entry)
        self.data["stats"]["total_failed"] += 1
        self.save()
    
    def get_stats(self) -> dict:
        """Retorna estadísticas del pipeline."""
        return self.data["stats"]
    
    def reset(self) -> None:
        """Reinicia el checkpoint (usar con precaución)."""
        self.checkpoint_file.unlink(missing_ok=True)
        self.data = self._load()


# ============================================================================
# 4. FUNCIONES DE HASH Y VALIDACIÓN
# ============================================================================

def compute_content_hash(content: bytes) -> str:
    """Genera SHA-256 hash de contenido para deduplicación."""
    return hashlib.sha256(content).hexdigest()


def compute_text_hash(text: str) -> str:
    """Genera SHA-256 hash de texto para deduplicación."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sanitize_filename(name: str) -> str:
    """Sanitiza un nombre para usar como nombre de archivo."""
    invalid_chars = '<>:"/\\|?*'
    for char in invalid_chars:
        name = name.replace(char, "_")
    return name.strip().strip(".")


def truncate_text(text: str, max_chars: int = 30000) -> str:
    """
    Trunca texto para respetar el límite de tokens de Gemini.
    Estimación conservadora: ~4 chars por token.
    max_chars=30000 ≈ 7500 tokens (bajo el límite de 8192).
    """
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "... [TRUNCADO]"


# ============================================================================
# 5. I/O HELPERS
# ============================================================================

def save_json(data: Any, filepath: Path, pretty: bool = True) -> None:
    """Guarda datos como JSON con encoding UTF-8."""
    filepath.parent.mkdir(parents=True, exist_ok=True)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2 if pretty else None, ensure_ascii=False)


def load_json(filepath: Path) -> Any:
    """Carga datos desde archivo JSON."""
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


def save_binary(data: bytes, filepath: Path) -> None:
    """Guarda datos binarios (imágenes, PDFs)."""
    filepath.parent.mkdir(parents=True, exist_ok=True)
    with open(filepath, "wb") as f:
        f.write(data)


def generate_audit_record(
    product_id: str,
    action: str,
    status: str,
    details: Optional[dict] = None
) -> dict:
    """
    Genera un registro de auditoría para cada operación.
    
    Returns:
        Dict con timestamp, acción, estado y detalles.
    """
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "product_id": product_id,
        "action": action,
        "status": status,
        "details": details or {}
    }
