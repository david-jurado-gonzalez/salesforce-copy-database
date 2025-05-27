### **Prompt for Generating a Salesforce Data Copier CLI Tool in TypeScript**

**## Project Overview**

You are tasked with creating a robust, command-line interface (CLI) tool using TypeScript and Node.js. The tool is designed for Salesforce developers to copy data between different Salesforce organizations. A key requirement is that the tool must intelligently handle relationships between records without requiring any schema modifications (like adding External ID fields) in the Salesforce orgs. The tool should be highly user-friendly, providing clear feedback, progress indicators, and safety checks.

**## Core Features & Requirements**

**1. CLI Structure & Commands:**
The tool must be operated via a CLI with the following commands and options, implemented using the `commander` library.

* `sfdc-data-copier extract --source <alias> --query <soql> [--config <path>]`
    * Extracts data from the source org based on a SOQL query.
    * Supports complex SOQL, including parent-to-child subqueries (e.g., `SELECT Name, (SELECT LastName FROM Contacts) FROM Account`).
* `sfdc-data-copier deploy --source <alias> --target <alias> [--config <path>] [--force]`
    * Deploys data from a local working directory (created by `extract`) to a target org.
    * The `--source` option here refers to the source *data directory*, not the org.
    * The `--force` flag should bypass any interactive safety prompts.
* `sfdc-data-copier list-objects --target <alias> [--config <path>]`
    * Lists all queryable SObjects available in the target organization.

**2. Authentication:**
The tool must support two methods for Salesforce authentication, checked in this order:

1.  **SFDX/SF CLI Alias Integration (Primary Method):** Automatically detect and use authentication information from the local Salesforce CLI setup. It should look for alias files (e.g., `my-dev-org.json`) in the user's `~/.sfdx/` directory, parse the `accessToken` and `instanceUrl`, and use them to connect with `jsforce`.
2.  **Configuration File (Fallback Method):** If an alias is not found locally, it should look for credentials (`loginUrl`, `username`, `password` with security token) within the `config.json` file.

**3. Configuration File:**
The tool will use a `config.json` file to define organization aliases and job-level settings.

```json
{
  "orgs": {
    "dev1": {
      "comment": "This alias will be resolved via local SFDX auth."
    },
    "uat-sandbox": {
      "loginUrl": "https://test.salesforce.com",
      "username": "user@uat.com",
      "password": "PASSWORD_AND_TOKEN"
    }
  },
  "jobConfig": {
    "personAccountsEnabled": false
  }
}
```

**4. Data Handling & Relationship Management:**
This is the most critical part of the project.

* **No External ID Fields:** The tool **must not** require users to create custom "External ID" fields on their SObjects.
* **Source ID -> Target ID Mapping:** To manage relationships, the tool must create and manage its own mapping files during deployment. For each record successfully inserted into the target org, it must store its original source ID and its new target ID in a local JSON file (e.g., `./workdir/<target_alias>/mappings/Account-map.json`).
* **Working Directory:** All extracted data and mapping files must be stored in a `./workdir/` directory, structured as follows: `./workdir/<org_alias>/{data,metadata,mappings}/`.
* **Data Format:** Extracted data must be stored in CSV format. When handling parent-to-child queries, the tool must "unroll" the data into separate CSV files for each object and maintain the relationship linkage.

**5. Intelligent Deployment Logic:**

* **Automatic Dependency Analysis:** Before deployment, the tool must analyze the SObjects involved in the job. It will make `describe` API calls to determine field relationships (Lookups, Master-Details), build a dependency graph, and perform a topological sort to calculate the correct deployment order automatically.
* **Two-Pass Deployment:** The tool must be able to handle circular dependencies or forward-looking optional lookups. It will implement a two-pass mechanism:
    1.  **Pass 1 (INSERT):** Insert all records with their direct fields and any required relationships that can be resolved. Leave optional/unresolvable lookups blank for now. Populate the ID mapping files during this pass.
    2.  **Pass 2 (UPDATE):** After Pass 1 is complete for all objects, iterate again through objects that had unresolved lookups. Use the now-complete set of ID mapping files to fill in the remaining relationship fields and perform a Bulk API `update`.
* **Bulk API:** All data loading operations (`insert`, `update`) must use Salesforce's Bulk API via `jsforce` for performance and efficiency.

**6. User Experience & Safety:**

* **Progress Indicators:** Use the `ora` library to display spinners for long-running operations like authentication, queries, and data processing.
* **Colored Output:** Use the `chalk` library for clear, color-coded console output (e.g., green for success, red for errors, yellow for warnings).
* **Interactive Prompts:** Use the `inquirer` library to prompt the user for confirmation before executing potentially destructive actions (like the `deploy` command). This prompt should be skippable with the `--force` flag.
* **Robust Logging:** Use the `winston` library to configure logging. It should output user-friendly messages to the console and detailed `debug`-level logs to a `debug.log` file.

**## Technology Stack**
* **Language:** TypeScript
* **Runtime:** Node.js
* **Core Libraries:**
    * `jsforce`: For all Salesforce API interactions.
    * `commander`: For building the CLI.
    * `inquirer`: For interactive prompts.
    * `ora`: For progress spinners.
    * `chalk`: For colored console output.
    * `winston`: For logging.
    * `csv-parse` & `csv-stringify`: For CSV handling.

**## Project Structure**
Please generate the code in the following modular directory structure:
```
/salesforce-data-copier/
|-- /src
|   |-- main.ts                 // CLI entry point using commander
|   |-- commands/
|   |   |-- extractCommand.ts
|   |   |-- deployCommand.ts
|   |   |-- listObjectsCommand.ts
|   |-- core/
|   |   |-- auth.ts             // Handles SFDX alias and config authentication
|   |   |-- sfdc-api.ts         // Wraps jsforce calls (describe, bulk, etc.)
|   |   |-- dependencyGraph.ts  // Logic for graph building and topological sort
|   |   |-- fileManager.ts      // Securely manages workdir, files, and config
|   |   |-- logger.ts           // Winston logger configuration
|   |   |-- typeDefs.ts         // Centralized TypeScript type and interface definitions
|-- package.json
|-- tsconfig.json
|-- config.sample.json        // A sample configuration file for users
```

**## Deliverables**

Provide the complete, runnable source code for all files within the specified project structure. The `package.json` file should list all necessary dependencies. The `tsconfig.json` file should be configured for a modern Node.js project. The code should be well-commented in English, explaining the logic of complex sections.

---