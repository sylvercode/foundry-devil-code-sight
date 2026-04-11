[CmdletBinding()]
param (
    [Parameter(HelpMessage = "The port number to use for the Edge DevTools Protocol connection.")]
    [ValidateRange(1, 65535)]
    [int]
    $Port = 9222,

    [Parameter(HelpMessage = "The web address to open a page.")]
    [string]
    $Url,

    [Parameter(HelpMessage = "The path to the Microsoft Edge executable.")]
    [string]
    $EdgePath,

    [Parameter(HelpMessage = "Profile name to use when launching Edge. If not specified, the default profile will be used.")]
    [string]
    $ProfileName
)

# Check if the EdgePath parameter is provided, if not, use the default path
if (-not $EdgePath) {
    # test id msedge executable is available in the system PATH
    $EdgePath = Get-Command msedge -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
    if (-not $EdgePath) {
        Write-Error "Microsoft Edge executable not found. Please provide the path to the Edge executable using the -EdgePath parameter."
        exit 1
    }
}

# Start Microsoft Edge with the specified port for remote debugging.
# --remote-allow-origins=* keeps CDP origin checks permissive for tooling scenarios.
# --no-first-run and --profile-directory --no-default-browser-check ensure a clean profile.
$EdgeArgs = "--remote-debugging-port=$Port --remote-allow-origins=* --no-first-run --no-default-browser-check"
if ($ProfileName) {
    $EdgeArgs += " --profile-directory=$ProfileName"
}
if ($Url) {
    $EdgeArgs += " $Url"
}

# Start Microsoft Edge with the constructed arguments
Start-Process -FilePath $EdgePath -ArgumentList $EdgeArgs
