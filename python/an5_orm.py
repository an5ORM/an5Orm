"""
AN5 ORM Python Entrypoint
"""
import os
import sys

# Ensure local monorepo adapter path is available for source execution & IDE linting
_local_adapters_dir = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "an5Adapters", "python")
)
if os.path.exists(_local_adapters_dir) and _local_adapters_dir not in sys.path:
    sys.path.insert(0, _local_adapters_dir)

try:
    from an5_adapter import An5Adapter, create_an5_adapter, AdapterTableClient
except ImportError:  # pragma: no cover
    try:
        from .an5_adapter import An5Adapter, create_an5_adapter, AdapterTableClient
    except ImportError:
        An5Adapter = None  # type: ignore
        create_an5_adapter = None  # type: ignore
        AdapterTableClient = None  # type: ignore

__all__ = ["An5Adapter", "create_an5_adapter", "AdapterTableClient"]
