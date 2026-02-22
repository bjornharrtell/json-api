using JsonApiServer.Data;
using JsonApiServer.Models;

namespace JsonApiServer;

public static class SeedData
{
    public static void Initialize(AppDbContext context)
    {
        context.Database.EnsureDeleted();
        context.Database.EnsureCreated();

        if (context.Articles.Any())
        {
            return;
        }

        var dan = new Person
        {
            FirstName = "Dan",
            LastName = "Gebhardt",
            Twitter = "dgeb",
        };

        var jane = new Person
        {
            FirstName = "Jane",
            LastName = "Doe",
            Twitter = "janedoe",
        };

        context.People.AddRange(dan, jane);
        context.SaveChanges();

        var article1 = new Article { Title = "JSON:API paints my bikeshed!", Author = dan };

        var article2 = new Article { Title = "Another article", Author = jane };

        context.Articles.AddRange(article1, article2);
        context.SaveChanges();

        var comment1 = new Comment
        {
            Body = "First!",
            Author = jane,
            Article = article1,
        };

        var comment2 = new Comment
        {
            Body = "I like XML better",
            Author = dan,
            Article = article1,
        };

        var comment3 = new Comment
        {
            Body = "Great article!",
            Author = dan,
            Article = article2,
        };

        context.Comments.AddRange(comment1, comment2, comment3);
        context.SaveChanges();
    }
}
