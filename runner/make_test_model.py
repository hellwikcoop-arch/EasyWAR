#!/usr/bin/env python3
"""Створює крихітну СИНТЕТИЧНУ модель (випадкові ваги) для перевірки протоколу рушія.

Це не мовна модель: вона видає безглуздий текст. Її єдина мета — дати рушію справжній GGUF
з архітектурою qwen3, щоб CI міг перевірити весь шлях «запит → токени → done» без завантаження
реальних вагів. Словник і правила злиття беруться з файлу `models/ggml-vocab-qwen2.gguf`
репозиторію llama.cpp (той самий токенізатор, що в Qwen3), ваги генеруються тут.

Використання:
    make_test_model.py --llama-src <каталог llama.cpp> --out <model.gguf>
"""

import argparse
import sys
from pathlib import Path

import numpy as np

# Крихітна форма моделі. head_dim * head_count = embedding_length, щоб формули збігалися з Qwen3.
EMBD = 64
LAYERS = 2
HEADS = 4
KV_HEADS = 2
HEAD_DIM = 16
FFN = 128
CONTEXT = 4096
# Шаблон лише для перевірки, що рушій помічає <think> і додає порожній блок міркувань.
CHAT_TEMPLATE = "{% for m in messages %}<|im_start|>{{ m.role }}\n{{ m.content }}<|im_end|>\n{% endfor %}<think>"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--llama-src", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    sys.path.insert(0, str(args.llama_src / "gguf-py"))
    from gguf import GGUFReader, GGUFWriter  # noqa: E402

    vocab_path = args.llama_src / "models" / "ggml-vocab-qwen2.gguf"
    reader = GGUFReader(str(vocab_path))
    tokens = reader.fields["tokenizer.ggml.tokens"].contents()
    token_types = reader.fields["tokenizer.ggml.token_type"].contents()
    merges = reader.fields["tokenizer.ggml.merges"].contents()
    eos = int(reader.fields["tokenizer.ggml.eos_token_id"].contents())
    vocab = len(tokens)

    rng = np.random.default_rng(args.seed)

    def weight(*shape: int) -> np.ndarray:
        return (rng.standard_normal(shape) * 0.05).astype(np.float16)

    def norm(size: int) -> np.ndarray:
        return np.ones(size, dtype=np.float32)

    writer = GGUFWriter(str(args.out), "qwen3")
    writer.add_name("easywar-synthetic-test-model")
    writer.add_block_count(LAYERS)
    writer.add_context_length(CONTEXT)
    writer.add_embedding_length(EMBD)
    writer.add_feed_forward_length(FFN)
    writer.add_head_count(HEADS)
    writer.add_head_count_kv(KV_HEADS)
    writer.add_key_length(HEAD_DIM)
    writer.add_value_length(HEAD_DIM)
    writer.add_layer_norm_rms_eps(1e-6)
    writer.add_rope_freq_base(1000000.0)
    writer.add_file_type(1)

    writer.add_tokenizer_model("gpt2")
    writer.add_tokenizer_pre("qwen2")
    writer.add_token_list(tokens)
    writer.add_token_types(token_types)
    writer.add_token_merges(merges)
    writer.add_eos_token_id(eos)
    writer.add_pad_token_id(eos)
    writer.add_bos_token_id(eos)
    writer.add_add_bos_token(False)
    writer.add_chat_template(CHAT_TEMPLATE)

    writer.add_tensor("token_embd.weight", weight(vocab, EMBD))
    writer.add_tensor("output_norm.weight", norm(EMBD))
    for i in range(LAYERS):
        prefix = f"blk.{i}"
        writer.add_tensor(f"{prefix}.attn_norm.weight", norm(EMBD))
        writer.add_tensor(f"{prefix}.attn_q.weight", weight(HEADS * HEAD_DIM, EMBD))
        writer.add_tensor(f"{prefix}.attn_k.weight", weight(KV_HEADS * HEAD_DIM, EMBD))
        writer.add_tensor(f"{prefix}.attn_v.weight", weight(KV_HEADS * HEAD_DIM, EMBD))
        writer.add_tensor(f"{prefix}.attn_output.weight", weight(EMBD, HEADS * HEAD_DIM))
        writer.add_tensor(f"{prefix}.attn_q_norm.weight", norm(HEAD_DIM))
        writer.add_tensor(f"{prefix}.attn_k_norm.weight", norm(HEAD_DIM))
        writer.add_tensor(f"{prefix}.ffn_norm.weight", norm(EMBD))
        writer.add_tensor(f"{prefix}.ffn_gate.weight", weight(FFN, EMBD))
        writer.add_tensor(f"{prefix}.ffn_up.weight", weight(FFN, EMBD))
        writer.add_tensor(f"{prefix}.ffn_down.weight", weight(EMBD, FFN))

    writer.write_header_to_file()
    writer.write_kv_data_to_file()
    writer.write_tensors_to_file()
    writer.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
