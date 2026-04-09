import pandas as pd
from datetime import datetime

# ─── Configuration ─────────────────────────────
input_file  = "input.xlsx"    # Replace with your Excel file
output_file = "output.xlsx"   # Fixed Excel output

# ─── Read Excel ───────────────────────────────
df = pd.read_excel(input_file, header=None)  # no headers assumed

# ─── Function to normalize date ───────────────
def fix_date(date_val):
    """
    Convert various date formats to dd/mm/yyyy
    """
    if pd.isna(date_val):
        return ""
    for fmt in ("%d/%m/%y", "%d/%m/%Y", "%m/%d/%y", "%Y-%m-%d"):
        try:
            return datetime.strptime(str(date_val), fmt).strftime("%d/%m/%Y")
        except ValueError:
            continue
    return str(date_val)  # fallback: keep original

# ─── Function to normalize time ───────────────
def fix_time(time_val):
    """
    Convert time to HH:MM (24-hour)
    """
    if pd.isna(time_val):
        return ""
    try:
        # Try float (Excel time) e.g. 0.22 = 0:22
        if isinstance(time_val, (float, int)):
            total_seconds = int(time_val * 24 * 60 * 60)
            hours = total_seconds // 3600
            minutes = (total_seconds % 3600) // 60
            return f"{hours:02d}:{minutes:02d}"
        # Otherwise try parsing string
        t = datetime.strptime(str(time_val), "%H:%M")
        return t.strftime("%H:%M")
    except ValueError:
        try:
            t = datetime.strptime(str(time_val), "%H:%M:%S")
            return t.strftime("%H:%M")
        except ValueError:
            return str(time_val)  # fallback

# ─── Apply normalization ──────────────────────
df[0] = df[0].apply(fix_date)  # first column = date
df[1] = df[1].apply(fix_time)  # second column = time

# ─── Save fixed Excel ────────────────────────
df.to_excel(output_file, index=False, header=False)

print(f"✅ Fixed Excel saved to {output_file}")