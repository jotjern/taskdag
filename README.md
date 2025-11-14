# TaskDAG

This project is a novel type of application: a "TODO" app. But this one is a [DAG](https://en.wikipedia.org/wiki/Directed_acyclic_graph)! This is my ideal vision for a TODO app which I've thought about for a long time. 

The app also has persistance, the infra for this is very primitive. The persistance is simply a lambda function which checks a password and gives read/write access to an S3 bucket if it is correct, where application state is persisted. 

Be warned this whole project is vibe-coded. 

PS: At the moment the interface only makes tree structures possible, but I might add non hierarchical todos later.


