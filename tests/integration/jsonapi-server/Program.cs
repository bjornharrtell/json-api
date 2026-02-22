using JsonApiDotNetCore.Configuration;
using JsonApiServer;
using JsonApiServer.Data;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// Create and keep an in-memory SQLite connection open
var keepAliveConnection = new SqliteConnection("Data Source=:memory:");
keepAliveConnection.Open();

// Add services to the container
builder.Services.AddDbContext<AppDbContext>(options =>
{
    options.UseSqlite(keepAliveConnection);
    options.EnableSensitiveDataLogging();
});

builder.Services.AddJsonApi<AppDbContext>(options =>
{
    options.Namespace = "api";
    options.UseRelativeLinks = true;
    options.IncludeTotalResourceCount = true;
});

// Add CORS
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader();
    });
});

var app = builder.Build();

// Seed the database
using (var scope = app.Services.CreateScope())
{
    var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    SeedData.Initialize(context);
}

app.UseCors();
app.UseRouting();
app.UseJsonApi();
app.MapControllers();

app.Run();

// Close the connection when the app stops
keepAliveConnection.Close();
keepAliveConnection.Dispose();
