"""Download and verify the optional, ignored Qwen evidence model.

Uses only Python's standard library. The model is never committed to this repo.
"""

from hashlib import sha256
from pathlib import Path
from urllib.request import urlopen

REVISION = "cd3d34a469f89b12676edce7d272750201959466"
FILENAME = "Qwen3-1.7B-Q4_K_M.gguf"
EXPECTED_SIZE = 1_107_408_544
EXPECTED_SHA256 = "228fb5627f7510b8b3516cdb6435e4b0d2a2bf330fe5b0ab19284a3570a8bb1f"
URL = f"https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/{REVISION}/{FILENAME}"
TARGET = Path(__file__).resolve().parents[1] / ".local-models" / FILENAME


def digest(path: Path) -> tuple[int, str]:
    hash_value = sha256()
    size = 0
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            size += len(chunk)
            hash_value.update(chunk)
    return size, hash_value.hexdigest()


def main() -> None:
    TARGET.parent.mkdir(exist_ok=True)
    if TARGET.exists():
        size, actual_hash = digest(TARGET)
        if size == EXPECTED_SIZE and actual_hash == EXPECTED_SHA256:
            print(f"Verified existing model: {TARGET}")
            return
        raise SystemExit("Existing model does not match the pinned source; remove it after inspection.")

    partial = TARGET.with_suffix(".part")
    if partial.exists():
        partial.unlink()
    try:
        with urlopen(URL, timeout=60) as source, partial.open("wb") as destination:
            hash_value = sha256()
            size = 0
            while chunk := source.read(1024 * 1024):
                size += len(chunk)
                if size > EXPECTED_SIZE:
                    raise ValueError("Model download exceeded expected size")
                hash_value.update(chunk)
                destination.write(chunk)
                if size and size % (64 * 1024 * 1024) < len(chunk):
                    print(f"Downloaded {size // (1024 * 1024)} MiB", flush=True)
        if size != EXPECTED_SIZE or hash_value.hexdigest() != EXPECTED_SHA256:
            raise ValueError("Downloaded model failed size or SHA-256 verification")
        partial.replace(TARGET)
        print(f"Verified model: {TARGET}")
    except Exception:
        partial.unlink(missing_ok=True)
        raise


if __name__ == "__main__":
    main()
