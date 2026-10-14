"""Run the real backend evaluator with media IO and draft persistence stubbed out."""

import ast
import copy
import json
import re
import sys
from contextlib import nullcontext
from pathlib import Path
from typing import Any, Dict, List, Union

from simpleeval import InvalidExpression, NameNotDefined, simple_eval


def main():
    backend = Path(sys.argv[1])
    names = {
        "evaluate_expression",
        "resolve_nested_variable",
        "evaluate_params_recursively",
        "execute_workflow_impl",
    }
    tree = ast.parse(backend.read_text())
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    if len(functions) != len(names):
        raise RuntimeError("Backend workflow contract functions changed")
    actions = []

    def execute_action(action_type, params):
        actions.append({"action_type": action_type, "params": copy.deepcopy(params)})
        return {"draft_id": "contract-draft"}

    scope = {
        "re": re, "json": json, "Any": Any, "Dict": Dict, "List": List, "Union": Union,
        "simple_eval": simple_eval, "InvalidExpression": InvalidExpression,
        "NameNotDefined": NameNotDefined,
        "workflow_persist_batch": nullcontext,
        "get_or_create_draft": lambda *args, **kwargs: ("contract-draft", None),
        "generate_draft_url": lambda *args: "contract://draft",
        "execute_action": execute_action,
    }
    exec(compile(ast.Module(body=functions, type_ignores=[]), str(backend), "exec"), scope)
    workflow = json.loads(Path(sys.argv[2]).read_text()) if len(sys.argv) > 2 else json.load(sys.stdin)
    scope["execute_workflow_impl"]("contract-key", "contract-user", workflow)
    print(json.dumps(actions))


if __name__ == "__main__":
    main()
