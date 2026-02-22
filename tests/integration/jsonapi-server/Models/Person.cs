using JsonApiDotNetCore.Resources;
using JsonApiDotNetCore.Resources.Annotations;

namespace JsonApiServer.Models;

[Resource(PublicName = "people")]
public class Person : Identifiable<int>
{
    [Attr]
    public string? FirstName { get; set; }

    [Attr]
    public string? LastName { get; set; }

    [Attr]
    public string? Twitter { get; set; }

    [HasMany]
    public ICollection<Comment> Comments { get; set; } = new List<Comment>();

    [HasMany]
    public ICollection<Article> AuthoredArticles { get; set; } = new List<Article>();
}
