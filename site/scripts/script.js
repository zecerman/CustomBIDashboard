// Overall script file, may need to break up into several later

// Used to populate the main dashboard widgit
async function loadDatabase(query) {

    const SQL = await initSqlJs({
        locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
    });

    // Buffer the .db file
    const response = await fetch("data/SampleData.db");
    const buffer = await response.arrayBuffer();

    // Load database
    const db = new SQL.Database(new Uint8Array(buffer));
    
    // Excecute query
    const result = db.exec(query);
    
    // Handle failure
    if(result.length === 0) return;
    // Prepare table including erasing an existing result
    const table = document.getElementById("dashboard");
    table.innerHTML = '';
    
    // Populate table
    const columns = result[0].columns;
    const values = result[0].values;
    // header
    let header = "<tr>";
    columns.forEach(col => header += `<th>${col}</th>`);
    header += "</tr>";
    table.innerHTML += header;

    // rows
    values.forEach(row => {
        let rowHTML = "<tr>";
        row.forEach(cell => rowHTML += `<td>${cell}</td>`);
        rowHTML += "</tr>";
        table.innerHTML += rowHTML;
    });
}

document.getElementById("dashboard_form").addEventListener("submit", function(event) {
    event.preventDefault(); // prevents page reload
    // Fetch user's string value
    const query = document.getElementById("dashboard_query").value;
    loadDatabase(query);
});



