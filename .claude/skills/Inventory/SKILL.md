```markdown
# Inventory Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches best practices and conventions for developing and maintaining the **Inventory** TypeScript codebase. You will learn about file naming, import/export styles, commit message patterns, and how to structure and run tests. This guide ensures consistency and clarity throughout the project.

## Coding Conventions

### File Naming
- **Use PascalCase** for all file names.
  - Example: `InventoryManager.ts`, `ProductList.ts`

### Import Style
- **Use alias imports** to reference modules.
  - Example:
    ```typescript
    import { Product } from '@models/Product';
    ```

### Export Style
- **Use named exports** for all modules.
  - Example:
    ```typescript
    // In InventoryManager.ts
    export function addItem(item: Item) { ... }
    export function removeItem(id: string) { ... }
    ```

### Commit Messages
- **Follow Conventional Commits** with the `feat` prefix for new features.
  - Example:
    ```
    feat: add inventory filtering by category
    ```
- **Average commit message length:** ~75 characters.

## Workflows

### Feature Development
**Trigger:** When adding a new feature to the codebase  
**Command:** `/feature-development`

1. Create a new TypeScript file using PascalCase.
2. Implement the feature using named exports.
3. Import dependencies using alias paths.
4. Write or update corresponding test files (`*.test.ts`).
5. Commit changes with a `feat:` prefix and a clear description.
    - Example: `feat: implement bulk inventory upload`

### Testing
**Trigger:** When verifying code correctness or before submitting changes  
**Command:** `/run-tests`

1. Ensure all test files follow the `*.test.*` pattern.
2. Run the test suite using the project's test runner (framework not specified).
3. Review and fix any failing tests.
4. Add or update tests as needed for new or changed functionality.

## Testing Patterns

- **Test file naming:** Use the `*.test.*` pattern (e.g., `InventoryManager.test.ts`).
- **Test framework:** Not explicitly specified; follow the existing pattern.
- **Placement:** Test files are typically located alongside or near the files they test.
- **Example:**
  ```typescript
  // InventoryManager.test.ts
  import { addItem } from '@managers/InventoryManager';

  test('adds a new item to inventory', () => {
    // test logic here
  });
  ```

## Commands
| Command              | Purpose                                         |
|----------------------|-------------------------------------------------|
| /feature-development | Start a new feature with proper conventions     |
| /run-tests           | Run all tests and check for correctness         |
```
