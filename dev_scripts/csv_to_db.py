import pandas as pd
import sqlite3
import os

# Prompt user
filename = input('Please enter the CSV\'s full path including filename: ').strip()

# Handle missing .csv
if not filename.lower().endswith(".csv"):
    filename += ".csv"
# Handle non-existent file
if not os.path.exists(filename):
    print("A file with that name was not found.")
    exit()

# File must exist, load into dataframe
df = pd.read_csv(filename)

# Create vars for execution
db_filename = os.path.splitext(filename)[0] + ".db"

# Map pandas dtypes to SQLite dtypes
dtypes = {}
for col, dtype in df.dtypes.items():
    if pd.api.types.is_integer_dtype(dtype):
        dtypes[col] = "INTEGER"
    elif pd.api.types.is_float_dtype(dtype):
        dtypes[col] = "REAL"
    else:
        dtypes[col] = "TEXT"

# Connect and write table
conn = sqlite3.connect(db_filename)

# Execute
df.to_sql(
    "Sample_Table",
    conn,
    if_exists="replace",
    index=False,
    dtype=dtypes
)

conn.close()
print(f'Database created successfully "{db_filename}"')